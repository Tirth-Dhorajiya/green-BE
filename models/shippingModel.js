const db = require('../config/db');

const deriveAggregateStatuses = (statuses) => {
  if (statuses.length && statuses.every((status) => status === 'returned')) {
    return { shipmentStatus: 'returned', orderStatus: 'cancelled' };
  }
  if (statuses.length && statuses.every((status) => status === 'delivered')) {
    return { shipmentStatus: 'delivered', orderStatus: 'delivered' };
  }
  if (statuses.length && statuses.every((status) => status === 'cancelled')) {
    return { shipmentStatus: 'cancelled', orderStatus: 'cancelled' };
  }
  if (statuses.some((status) => ['in_transit', 'out_for_delivery', 'delivered', 'exception'].includes(status))) {
    return {
      shipmentStatus: statuses.some((status) => ['exception', 'cancelled'].includes(status)) ? 'partial' : 'in_transit',
      orderStatus: 'shipped',
    };
  }
  if (statuses.some((status) => ['returning', 'returned'].includes(status))) {
    return { shipmentStatus: 'returning', orderStatus: 'shipped' };
  }
  return { shipmentStatus: 'manifested', orderStatus: 'processing' };
};

const safeShipmentSelect = `
  SELECT s.id, s.order_id, s.provider, s.provider_reference, s.provider_upload_id,
         s.pickup_location, s.ewaybill_number, s.direction, s.purpose, s.return_request_id,
         s.status, s.failure_message, s.manifested_at,
         s.cancelled_at, s.last_synced_at, s.created_at, s.updated_at,
         COALESCE((
           SELECT json_agg(
             json_build_object(
               'id', p.id,
               'sequence', p.sequence,
               'waybill', p.waybill,
               'weight_grams', p.weight_grams,
               'length_cm', p.length_cm,
               'width_cm', p.width_cm,
               'height_cm', p.height_cm,
               'contents', p.contents,
               'status', p.status,
               'status_code', p.status_code,
               'status_type', p.status_type,
               'status_description', p.status_description,
               'status_location', p.status_location,
               'estimated_delivery_date', p.estimated_delivery_date,
               'last_event_at', p.last_event_at,
               'events', COALESCE((
                 SELECT json_agg(
                   json_build_object(
                     'id', e.id,
                     'status', e.status,
                     'status_code', e.status_code,
                     'status_type', e.status_type,
                     'location', e.location,
                     'instructions', e.instructions,
                     'occurred_at', e.occurred_at
                   ) ORDER BY e.occurred_at DESC
                 )
                 FROM shipment_tracking_events e
                 WHERE e.package_id = p.id
               ), '[]'::json)
             ) ORDER BY p.sequence
           )
           FROM shipping_packages p
           WHERE p.shipment_id = s.id
         ), '[]'::json) AS packages
  FROM shipping_shipments s`;

const getForOrders = async (orderIds, { includeFailed = false } = {}) => {
  if (!orderIds.length) return [];
  const failedFilter = includeFailed ? '' : " AND s.status != 'failed'";
  const { rows } = await db.query(`${safeShipmentSelect} WHERE s.order_id = ANY($1::uuid[])${failedFilter} ORDER BY s.created_at DESC`, [orderIds]);
  return rows;
};

const attachShipments = async (orders, options = {}) => {
  if (!orders.length) return orders;
  const shipments = await getForOrders(orders.map((order) => order.id), options);
  const grouped = shipments.reduce((map, shipment) => {
    if (!map.has(shipment.order_id)) map.set(shipment.order_id, []);
    map.get(shipment.order_id).push(shipment);
    return map;
  }, new Map());
  return orders.map((order) => ({ ...order, shipments: grouped.get(order.id) || [] }));
};

const getById = async (shipmentId) => {
  const { rows } = await db.query(`${safeShipmentSelect} WHERE s.id = $1`, [shipmentId]);
  return rows[0] || null;
};

const getActiveByOrder = (orderId) =>
  db.query(
    `SELECT * FROM shipping_shipments
     WHERE order_id = $1 AND direction = 'forward' AND purpose = 'fulfilment'
       AND status IN ('creating', 'manifested', 'in_transit', 'partial', 'exception')
     ORDER BY created_at DESC LIMIT 1`,
    [orderId]
  );

const createDraft = async ({
  orderId, providerReference, pickupLocation, ewaybillNumber, packages, createdBy,
  direction = 'forward', purpose = 'fulfilment', returnRequestId = null,
}) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const active = await client.query(
      `SELECT id FROM shipping_shipments
       WHERE (($2::uuid IS NOT NULL AND return_request_id = $2 AND direction = $3 AND purpose = $4)
          OR ($2::uuid IS NULL AND order_id = $1 AND direction = $3 AND purpose = $4))
         AND status IN ('creating', 'manifested', 'in_transit', 'partial', 'exception')
       ORDER BY created_at DESC LIMIT 1`,
      [orderId, returnRequestId, direction, purpose]
    );
    if (active.rows.length) {
      await client.query('COMMIT');
      return { existing: true, shipmentId: active.rows[0].id };
    }

    const { rows } = await client.query(
      `INSERT INTO shipping_shipments
        (order_id, provider_reference, pickup_location, ewaybill_number, created_by, direction, purpose, return_request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [orderId, providerReference, pickupLocation, ewaybillNumber || null, createdBy, direction, purpose, returnRequestId]
    );
    for (let index = 0; index < packages.length; index += 1) {
      const pkg = packages[index];
      await client.query(
        `INSERT INTO shipping_packages
          (shipment_id, sequence, weight_grams, length_cm, width_cm, height_cm, contents)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [rows[0].id, index + 1, pkg.weight_grams, pkg.length_cm, pkg.width_cm, pkg.height_cm, pkg.contents]
      );
    }
    await client.query('COMMIT');
    return { existing: false, shipmentId: rows[0].id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const assignWaybills = async (shipmentId, waybills) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT id FROM shipping_packages WHERE shipment_id = $1 ORDER BY sequence FOR UPDATE', [shipmentId]);
    if (rows.length !== waybills.length) throw new Error('Waybill count does not match package count');
    for (let index = 0; index < rows.length; index += 1) {
      await client.query('UPDATE shipping_packages SET waybill = $1, updated_at = NOW() WHERE id = $2', [waybills[index], rows[index].id]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const markManifested = async (shipmentId, response) => {
  await db.query(
    `UPDATE shipping_shipments
     SET status = 'manifested', provider_upload_id = $2, raw_response = $3,
         manifested_at = NOW(), last_synced_at = NOW(), updated_at = NOW(), failure_message = NULL
     WHERE id = $1`,
    [shipmentId, response?.upload_wbn || null, response || {}]
  );
  await db.query(`UPDATE shipping_packages SET status = 'manifested', updated_at = NOW() WHERE shipment_id = $1`, [shipmentId]);
};

const markFailed = (shipmentId, message, response = {}) =>
  db.query(
    `UPDATE shipping_shipments SET status = 'failed', failure_message = $2, raw_response = $3, updated_at = NOW() WHERE id = $1`,
    [shipmentId, message, response || {}]
  );

const getPackageByWaybill = (waybill) =>
  db.query(
    `SELECT p.*, s.order_id FROM shipping_packages p
     JOIN shipping_shipments s ON s.id = p.shipment_id
     WHERE p.waybill = $1 LIMIT 1`,
    [waybill]
  );

const getPackageById = (packageId, shipmentId) =>
  db.query(
    `SELECT p.*, s.order_id FROM shipping_packages p
     JOIN shipping_shipments s ON s.id = p.shipment_id
     WHERE p.id = $1 AND p.shipment_id = $2 LIMIT 1`,
    [packageId, shipmentId]
  );

const recordTrackingEvent = async ({ waybill, event, eventKey, normalizedStatus, estimatedDeliveryDate }) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT p.*, s.order_id, s.direction, s.purpose, s.return_request_id FROM shipping_packages p
       JOIN shipping_shipments s ON s.id = p.shipment_id
       WHERE p.waybill = $1 FOR UPDATE`,
      [waybill]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return null;
    }
    const pkg = rows[0];
    const occurredAt = new Date(event.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) occurredAt.setTime(Date.now());
    await client.query(
      `INSERT INTO shipment_tracking_events
        (package_id, event_key, status, status_code, status_type, location, instructions, occurred_at, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (package_id, event_key) DO NOTHING`,
      [pkg.id, eventKey, event.status, event.statusCode || null, event.statusType || null, event.location || null, event.instructions || null, occurredAt, event.raw || {}]
    );
    if (!pkg.last_event_at || occurredAt >= new Date(pkg.last_event_at)) {
      await client.query(
        `UPDATE shipping_packages
         SET status = $2, status_code = $3, status_type = $4, status_description = $5,
             status_location = $6, estimated_delivery_date = COALESCE($7, estimated_delivery_date),
             last_event_at = $8, raw_response = $9, updated_at = NOW()
         WHERE id = $1`,
        [pkg.id, normalizedStatus, event.statusCode || null, event.statusType || null, event.status, event.location || null, estimatedDeliveryDate || null, occurredAt, event.raw || {}]
      );
    }
    await client.query('UPDATE shipping_shipments SET last_synced_at = NOW(), updated_at = NOW() WHERE id = $1', [pkg.shipment_id]);
    await client.query('COMMIT');
    return { shipmentId: pkg.shipment_id, orderId: pkg.order_id, direction: pkg.direction, purpose: pkg.purpose, returnRequestId: pkg.return_request_id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const aggregateShipment = async (shipmentId) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: shipmentRows } = await client.query('SELECT * FROM shipping_shipments WHERE id = $1 FOR UPDATE', [shipmentId]);
    if (!shipmentRows.length) {
      await client.query('ROLLBACK');
      return null;
    }
    const shipment = shipmentRows[0];
    const { rows: packages } = await client.query('SELECT * FROM shipping_packages WHERE shipment_id = $1 ORDER BY sequence', [shipmentId]);
    const statuses = packages.map((pkg) => pkg.status);
    const { shipmentStatus, orderStatus } = deriveAggregateStatuses(statuses);

    if (shipment.direction === 'reverse' || shipment.purpose !== 'fulfilment') {
      const providerStatus = shipmentStatus === 'delivered' && shipment.direction === 'reverse' ? 'returned' : shipmentStatus;
      await client.query(
        `UPDATE shipping_shipments SET status = $2, updated_at = NOW(),
           cancelled_at = CASE WHEN $2 = 'cancelled' THEN COALESCE(cancelled_at, NOW()) ELSE cancelled_at END
         WHERE id = $1`, [shipmentId, providerStatus]
      );
      let returnStatus = null;
      if (shipment.return_request_id && shipment.direction === 'reverse') {
        returnStatus = providerStatus === 'returned' ? 'received'
          : providerStatus === 'cancelled' ? 'exception'
            : ['in_transit', 'partial'].includes(providerStatus) ? 'reverse_in_transit'
              : 'reverse_pending';
        const { rows: returnRows } = await client.query('SELECT status FROM return_requests WHERE id = $1 FOR UPDATE', [shipment.return_request_id]);
        if (returnRows.length && returnRows[0].status !== returnStatus && !['resolved', 'rejected', 'cancelled'].includes(returnRows[0].status)) {
          await client.query(
            `UPDATE return_requests SET status = $2,
               received_at = CASE WHEN $2 = 'received' THEN COALESCE(received_at, NOW()) ELSE received_at END,
               updated_at = NOW() WHERE id = $1`, [shipment.return_request_id, returnStatus]
          );
          await client.query(
            `INSERT INTO return_status_history (return_request_id, from_status, to_status, note)
             VALUES ($1, $2, $3, $4)`, [shipment.return_request_id, returnRows[0].status, returnStatus, `Updated from Delhivery ${shipment.provider_reference}`]
          );
        }
      }
      if (shipment.return_request_id && shipment.purpose === 'replacement' && providerStatus === 'delivered') {
        const { rows: returnRows } = await client.query('SELECT status FROM return_requests WHERE id = $1 FOR UPDATE', [shipment.return_request_id]);
        const { rows: refundRows } = await client.query(
          `SELECT COUNT(*) FILTER (WHERE status IN ('creating', 'pending')) AS pending,
                  COUNT(*) FILTER (WHERE status = 'processed') AS processed
           FROM payment_refunds WHERE return_request_id = $1`, [shipment.return_request_id]
        );
        if (returnRows.length && returnRows[0].status !== 'resolved' && Number(refundRows[0].pending) === 0) {
          await client.query(
            `UPDATE return_requests SET status = 'resolved', resolution_type = CASE WHEN $2 > 0 THEN 'mixed' ELSE 'replacement' END,
               resolved_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [shipment.return_request_id, Number(refundRows[0].processed)]
          );
          await client.query(
            `INSERT INTO return_status_history (return_request_id, from_status, to_status, note)
             VALUES ($1, $2, 'resolved', $3)`, [shipment.return_request_id, returnRows[0].status, 'Replacement delivered']
          );
          returnStatus = 'resolved';
        }
      }
      await client.query('COMMIT');
      return { orderId: shipment.order_id, previousOrderStatus: null, orderStatus: null, shipmentStatus: providerStatus, returnRequestId: shipment.return_request_id, returnStatus };
    }

    await client.query(
      `UPDATE shipping_shipments
       SET status = $2,
           cancelled_at = CASE WHEN $2 = 'cancelled' THEN COALESCE(cancelled_at, NOW()) ELSE cancelled_at END,
           updated_at = NOW()
       WHERE id = $1`,
      [shipmentId, shipmentStatus]
    );

    const { rows: orderRows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [shipment.order_id]);
    const order = orderRows[0];
    const ranks = { pending: 0, processing: 1, shipped: 2, delivered: 3 };
    const shouldUpdate = orderStatus === 'cancelled' || order.status !== 'cancelled' && ranks[orderStatus] > (ranks[order.status] ?? -1);
    const primary = packages.find((pkg) => pkg.waybill);
    const eta = packages.map((pkg) => pkg.estimated_delivery_date).filter(Boolean).sort()[0] || null;
    const nextOrderStatus = shouldUpdate ? orderStatus : order.status;
    await client.query(
      `UPDATE orders
       SET status = $2, courier_name = 'Delhivery', tracking_number = COALESCE($3, tracking_number),
           estimated_delivery_date = COALESCE($4, estimated_delivery_date), updated_at = NOW()
       WHERE id = $1`,
      [order.id, nextOrderStatus, primary?.waybill || null, eta]
    );
    if (nextOrderStatus === 'delivered') {
      await client.query('UPDATE orders SET delivered_at = COALESCE(delivered_at, NOW()) WHERE id = $1', [order.id]);
    }
    if (nextOrderStatus !== order.status) {
      await client.query(
        `INSERT INTO order_status_history (order_id, from_status, to_status, note)
         VALUES ($1, $2, $3, $4)`,
        [order.id, order.status, nextOrderStatus, `Updated from Delhivery shipment ${shipment.provider_reference}`]
      );
    }
    await client.query('COMMIT');
    return { orderId: order.id, previousOrderStatus: order.status, orderStatus: nextOrderStatus, shipmentStatus };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getReconcileShipments = () =>
  db.query(
    `SELECT s.id, s.provider_reference, array_agg(p.waybill ORDER BY p.sequence) AS waybills
     FROM shipping_shipments s
     JOIN shipping_packages p ON p.shipment_id = s.id
     WHERE s.status IN ('manifested', 'in_transit', 'partial', 'returning', 'exception') AND p.waybill IS NOT NULL
     GROUP BY s.id ORDER BY COALESCE(s.last_synced_at, s.created_at) ASC LIMIT 100`
  );

const markPackagesCancelled = (shipmentId) =>
  db.query(
    `UPDATE shipping_packages SET status = 'cancelled', status_description = 'Cancelled', last_event_at = NOW(), updated_at = NOW()
     WHERE shipment_id = $1 AND status NOT IN ('delivered', 'cancelled')`,
    [shipmentId]
  );

const createPickupRequest = ({ providerPickupId, pickupLocation, pickupDate, pickupTime, expectedPackageCount, createdBy, response }) =>
  db.query(
    `INSERT INTO shipping_pickup_requests
      (provider_pickup_id, pickup_location, pickup_date, pickup_time, expected_package_count, created_by, raw_response)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [providerPickupId || null, pickupLocation, pickupDate, pickupTime, expectedPackageCount, createdBy, response || {}]
  );

const getPickupRequests = () =>
  db.query(
    `SELECT id, provider, provider_pickup_id, pickup_location, pickup_date, pickup_time,
            expected_package_count, status, created_at, updated_at
     FROM shipping_pickup_requests ORDER BY created_at DESC LIMIT 50`
  );

const getOpenPickupRequest = (pickupLocation) =>
  db.query(
    `SELECT * FROM shipping_pickup_requests
     WHERE pickup_location = $1 AND status = 'scheduled'
     ORDER BY created_at DESC LIMIT 1`,
    [pickupLocation]
  );

const updatePickupStatus = (pickupId, status) =>
  db.query(
    `UPDATE shipping_pickup_requests SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [pickupId, status]
  );

module.exports = {
  deriveAggregateStatuses,
  attachShipments,
  getForOrders,
  getById,
  getActiveByOrder,
  createDraft,
  assignWaybills,
  markManifested,
  markFailed,
  getPackageByWaybill,
  getPackageById,
  recordTrackingEvent,
  aggregateShipment,
  getReconcileShipments,
  markPackagesCancelled,
  createPickupRequest,
  getPickupRequests,
  getOpenPickupRequest,
  updatePickupStatus,
};
