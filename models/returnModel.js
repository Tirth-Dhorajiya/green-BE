const db = require('../config/db');

const safeRefundFields = `id, order_id, return_request_id, parent_refund_id, razorpay_refund_id,
  receipt, amount_paise, currency, status, speed_requested, speed_processed,
  failure_code, failure_message, arn, created_at, updated_at, processed_at`;

const getOrderContext = (orderId, userId) => db.query(
  `SELECT o.*, u.name AS user_name, u.email AS user_email,
          COALESCE(json_agg(json_build_object(
            'id', oi.id, 'product_id', oi.product_id, 'quantity', oi.quantity,
            'price', oi.price, 'product_name', COALESCE(oi.product_name_snapshot, p.name),
            'category_snapshot', COALESCE(oi.category_snapshot, p.category),
            'return_policy_snapshot', COALESCE(oi.return_policy_snapshot, p.return_policy,
              CASE WHEN p.category = 'plants' THEN 'damage_only' ELSE 'returnable' END),
            'return_window_hours_snapshot', COALESCE(oi.return_window_hours_snapshot, p.return_window_hours,
              CASE WHEN p.category = 'plants' THEN 48 ELSE 168 END),
            'final_sale_snapshot', COALESCE(oi.final_sale_snapshot, p.final_sale, FALSE),
            'net_unit_amount', COALESCE(oi.net_unit_amount, oi.price),
            'image_url', COALESCE(p.thumbnail_url, p.image_url)
          ) ORDER BY p.name) FILTER (WHERE oi.id IS NOT NULL), '[]'::json) AS items
   FROM orders o
   JOIN users u ON u.id = o.user_id
   LEFT JOIN order_items oi ON oi.order_id = o.id
   LEFT JOIN products p ON p.id = oi.product_id
   WHERE o.id = $1 AND ($2::uuid IS NULL OR o.user_id = $2)
   GROUP BY o.id, u.name, u.email`,
  [orderId, userId || null]
);

const createRequest = async ({ order, userId, preferredResolution, explanation, items, evidence }) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [order.id]);
    for (const item of items) {
      const { rows } = await client.query(
        `SELECT oi.quantity - COALESCE((
           SELECT SUM(ri.quantity) FROM return_items ri
           JOIN return_requests rr ON rr.id = ri.return_request_id
           WHERE ri.order_item_id = oi.id AND rr.status NOT IN ('rejected', 'cancelled')
         ), 0) AS available
         FROM order_items oi WHERE oi.id = $1 AND oi.order_id = $2`,
        [item.orderItemId, order.id]
      );
      if (!rows.length || Number(rows[0].available) < item.quantity) {
        const error = new Error('Requested return quantity is no longer available');
        error.statusCode = 409;
        throw error;
      }
    }

    const requestNumber = `RET-${Date.now().toString(36).toUpperCase()}-${String(order.id).replace(/-/g, '').slice(0, 6).toUpperCase()}`;
    const { rows } = await client.query(
      `INSERT INTO return_requests (request_number, order_id, user_id, preferred_resolution, explanation, reverse_required)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [requestNumber, order.id, userId, preferredResolution, explanation || null, items.some((item) => item.reverseRequired)]
    );
    const request = rows[0];
    for (const item of items) {
      await client.query(
        `INSERT INTO return_items (return_request_id, order_item_id, quantity, reason, requested_amount_paise)
         VALUES ($1, $2, $3, $4, $5)`,
        [request.id, item.orderItemId, item.quantity, item.reason, item.amountPaise]
      );
    }
    for (const file of evidence || []) {
      await client.query(
        `INSERT INTO return_evidence (return_request_id, url, public_id, kind) VALUES ($1, $2, $3, $4)`,
        [request.id, file.url, file.publicId || null, file.kind || 'product']
      );
    }
    await client.query(
      `INSERT INTO return_status_history (return_request_id, to_status, actor_id, note)
       VALUES ($1, 'requested', $2, 'Return requested by customer')`,
      [request.id, userId]
    );
    await client.query('COMMIT');
    return request.id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const getDetailed = async (returnId, { userId } = {}) => {
  const { rows } = await db.query(
    `SELECT rr.*, o.total_price, o.payment_status, o.razorpay_payment_id, o.shipping_address,
            o.delivered_at, u.name AS customer_name, u.email AS customer_email
     FROM return_requests rr
     JOIN orders o ON o.id = rr.order_id
     JOIN users u ON u.id = rr.user_id
     WHERE rr.id = $1 AND ($2::uuid IS NULL OR rr.user_id = $2)`,
    [returnId, userId || null]
  );
  if (!rows.length) return null;
  const result = rows[0];
  const [items, evidence, history, refunds, shipments] = await Promise.all([
    db.query(
      `SELECT ri.*, oi.product_id, oi.quantity AS purchased_quantity, oi.price,
              COALESCE(oi.product_name_snapshot, p.name) AS product_name,
              COALESCE(oi.category_snapshot, p.category) AS category,
              COALESCE(p.thumbnail_url, p.image_url) AS image_url
       FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
       JOIN products p ON p.id = oi.product_id WHERE ri.return_request_id = $1 ORDER BY ri.created_at`, [returnId]
    ),
    db.query('SELECT id, url, kind, created_at FROM return_evidence WHERE return_request_id = $1 ORDER BY created_at', [returnId]),
    db.query('SELECT id, from_status, to_status, note, metadata, created_at FROM return_status_history WHERE return_request_id = $1 ORDER BY created_at', [returnId]),
    db.query(`SELECT ${safeRefundFields} FROM payment_refunds WHERE return_request_id = $1 ORDER BY created_at`, [returnId]),
    db.query(
      `SELECT id, provider, provider_reference, direction, purpose, status, failure_message, manifested_at, last_synced_at, created_at,
              COALESCE((SELECT json_agg(json_build_object(
                'id', sp.id, 'sequence', sp.sequence, 'waybill', sp.waybill, 'contents', sp.contents,
                'status', sp.status, 'status_description', sp.status_description, 'status_location', sp.status_location,
                'estimated_delivery_date', sp.estimated_delivery_date, 'last_event_at', sp.last_event_at,
                'events', COALESCE((SELECT json_agg(json_build_object(
                  'id', ste.id, 'status', ste.status, 'location', ste.location,
                  'instructions', ste.instructions, 'occurred_at', ste.occurred_at
                ) ORDER BY ste.occurred_at DESC) FROM shipment_tracking_events ste WHERE ste.package_id = sp.id), '[]'::json)
              ) ORDER BY sp.sequence) FROM shipping_packages sp WHERE sp.shipment_id = s.id), '[]'::json) AS packages
       FROM shipping_shipments s WHERE s.return_request_id = $1 ORDER BY s.created_at`, [returnId]
    ),
  ]);
  return { ...result, items: items.rows, evidence: evidence.rows, history: history.rows, refunds: refunds.rows, shipments: shipments.rows };
};

const listForOrders = async (orderIds, userId) => {
  if (!orderIds.length) return [];
  const { rows } = await db.query(
    `SELECT id FROM return_requests WHERE order_id = ANY($1::uuid[]) AND ($2::uuid IS NULL OR user_id = $2) ORDER BY created_at DESC`,
    [orderIds, userId || null]
  );
  return Promise.all(rows.map((row) => getDetailed(row.id, { userId })));
};

const attachReturns = async (orders, userId = null) => {
  if (!orders.length) return orders;
  const returns = await listForOrders(orders.map((order) => order.id), userId);
  const { rows: refunds } = await db.query(
    `SELECT ${safeRefundFields} FROM payment_refunds WHERE order_id = ANY($1::uuid[]) ORDER BY created_at DESC`,
    [orders.map((order) => order.id)]
  );
  return orders.map((order) => ({
    ...order,
    returns: returns.filter((item) => item.order_id === order.id),
    refunds: refunds.filter((refund) => refund.order_id === order.id),
  }));
};

const listAdmin = async ({ status, search, limit, offset }) => {
  const values = [];
  const conditions = [];
  let index = 1;
  if (status) { conditions.push(`rr.status = $${index++}`); values.push(status); }
  if (search) {
    conditions.push(`(rr.request_number ILIKE $${index} OR rr.order_id::text ILIKE $${index} OR u.name ILIKE $${index} OR u.email ILIKE $${index})`);
    values.push(`%${search}%`); index += 1;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  values.push(limit, offset);
  return db.query(
    `SELECT rr.*, u.name AS customer_name, u.email AS customer_email, o.total_price, o.payment_status,
            COALESCE((SELECT SUM(requested_amount_paise) FROM return_items WHERE return_request_id = rr.id), 0) AS requested_amount_paise,
            COUNT(*) OVER() AS total_count
     FROM return_requests rr JOIN users u ON u.id = rr.user_id JOIN orders o ON o.id = rr.order_id
     ${where} ORDER BY rr.created_at DESC LIMIT $${index++} OFFSET $${index++}`, values
  );
};

const transition = async (returnId, nextStatus, { actorId, note, metadata = {}, fields = {} } = {}) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM return_requests WHERE id = $1 FOR UPDATE', [returnId]);
    if (!rows.length) { await client.query('ROLLBACK'); return null; }
    const current = rows[0];
    const set = ['status = $2', 'updated_at = NOW()'];
    const values = [returnId, nextStatus];
    const allowed = ['inspection_status', 'resolution_type', 'admin_reason', 'reverse_required', 'manual_return', 'approved_by', 'approved_at', 'received_at', 'resolved_at', 'cancelled_at'];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) { values.push(fields[key]); set.push(`${key} = $${values.length}`); }
    }
    const updated = await client.query(`UPDATE return_requests SET ${set.join(', ')} WHERE id = $1 RETURNING *`, values);
    await client.query(
      `INSERT INTO return_status_history (return_request_id, from_status, to_status, actor_id, note, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [returnId, current.status, nextStatus, actorId || null, note || null, metadata]
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
};

const approveItems = async (returnId, approvedItems) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of approvedItems) {
      const result = await client.query(
        `UPDATE return_items SET approved_quantity = $2, updated_at = NOW()
         WHERE id = $1 AND return_request_id = $3 AND $2 BETWEEN 0 AND quantity RETURNING id`,
        [item.id, item.approved_quantity, returnId]
      );
      if (!result.rowCount) { const error = new Error('Invalid approved return quantity'); error.statusCode = 400; throw error; }
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
};

const inspectItems = async (returnId, inspections, actorId) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: requests } = await client.query('SELECT * FROM return_requests WHERE id = $1 FOR UPDATE', [returnId]);
    if (!requests.length) { const error = new Error('Return request not found'); error.statusCode = 404; throw error; }
    if (requests[0].inspection_status !== 'pending') { const error = new Error('Warehouse inspection has already been recorded'); error.statusCode = 409; throw error; }
    const canInspect = requests[0].status === 'received' || (requests[0].status === 'approved' && requests[0].manual_return);
    if (!canInspect) {
      const error = new Error('This return cannot be inspected in its current state'); error.statusCode = 409; throw error;
    }
    let passed = 0;
    let failed = 0;
    for (const item of inspections) {
      const { rows } = await client.query('SELECT ri.*, oi.product_id FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id WHERE ri.id = $1 AND ri.return_request_id = $2 FOR UPDATE', [item.id, returnId]);
      if (!rows.length || item.received_quantity < 0 || item.received_quantity > rows[0].approved_quantity) {
        const error = new Error('Invalid received quantity'); error.statusCode = 400; throw error;
      }
      const accepted = item.accepted_quantity ?? item.received_quantity;
      if (accepted < 0 || accepted > item.received_quantity) { const error = new Error('Invalid accepted quantity'); error.statusCode = 400; throw error; }
      passed += accepted; failed += item.received_quantity - accepted;
      await client.query(
        `UPDATE return_items SET received_quantity = $2, accepted_quantity = $3, condition_note = $4, resellable = $5, updated_at = NOW() WHERE id = $1`,
        [item.id, item.received_quantity, accepted, item.condition_note || null, item.resellable === true]
      );
      if (item.resellable && accepted > 0) await client.query('UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2', [accepted, rows[0].product_id]);
    }
    const inspectionStatus = passed && failed ? 'partial' : passed ? 'passed' : 'failed';
    const nextStatus = passed ? 'resolution_pending' : 'rejected';
    await client.query(
      `UPDATE return_requests SET status = $2, inspection_status = $3, received_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [returnId, nextStatus, inspectionStatus]
    );
    await client.query(
      `INSERT INTO return_status_history (return_request_id, from_status, to_status, actor_id, note, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [returnId, requests[0].status, nextStatus, actorId, 'Warehouse inspection recorded', { inspectionStatus }]
    );
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
};

const reserveRefund = async ({ orderId, returnRequestId, paymentId, amountPaise, actorId, parentRefundId }) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (!rows.length || !paymentId) { const error = new Error('A captured Razorpay payment is required'); error.statusCode = 409; throw error; }
    const totals = await client.query(
      `SELECT COALESCE(SUM(amount_paise), 0) AS reserved FROM payment_refunds
       WHERE order_id = $1 AND status IN ('creating', 'pending', 'processed')`, [orderId]
    );
    const paidPaise = Math.round(Number(rows[0].total_price) * 100);
    if (amountPaise <= 0 || Number(totals.rows[0].reserved) + amountPaise > paidPaise) {
      const error = new Error('Refund amount exceeds the remaining captured payment'); error.statusCode = 409; throw error;
    }
    const token = require('crypto').randomUUID();
    const receipt = `refund_${token.replace(/-/g, '').slice(0, 24)}`;
    const { rows: refundRows } = await client.query(
      `INSERT INTO payment_refunds
        (order_id, return_request_id, parent_refund_id, razorpay_payment_id, receipt, idempotency_key, amount_paise, currency, initiated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'INR', $8) RETURNING *`,
      [orderId, returnRequestId || null, parentRefundId || null, paymentId, receipt, token, amountPaise, actorId]
    );
    await client.query("UPDATE orders SET payment_status = 'refund_pending', updated_at = NOW() WHERE id = $1", [orderId]);
    await client.query('COMMIT');
    return refundRows[0];
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
};

const recalculatePaymentStatus = async (orderId) => {
  const { rows } = await db.query(
    `SELECT o.total_price,
      COALESCE(SUM(pr.amount_paise) FILTER (WHERE pr.status = 'processed'), 0) AS processed,
      COUNT(*) FILTER (WHERE pr.status IN ('creating', 'pending')) AS pending
     FROM orders o LEFT JOIN payment_refunds pr ON pr.order_id = o.id WHERE o.id = $1 GROUP BY o.id`, [orderId]
  );
  if (!rows.length) return null;
  const paid = Math.round(Number(rows[0].total_price) * 100);
  const processed = Number(rows[0].processed);
  const status = Number(rows[0].pending) > 0 ? 'refund_pending' : processed >= paid ? 'refunded' : processed > 0 ? 'partially_refunded' : 'paid';
  await db.query('UPDATE orders SET payment_status = $2, updated_at = NOW() WHERE id = $1', [orderId, status]);
  return status;
};

const updateRefund = async (refundId, providerRefund, failure = null) => {
  const status = failure ? (failure.ambiguous ? 'pending' : 'failed') : providerRefund.status === 'processed' ? 'processed' : providerRefund.status === 'failed' ? 'failed' : 'pending';
  const { rows: currentRows } = await db.query('SELECT * FROM payment_refunds WHERE id = $1', [refundId]);
  if (!currentRows.length) return null;
  if (currentRows[0].status === 'processed' && status !== 'processed') return currentRows[0];
  const { rows } = await db.query(
    `UPDATE payment_refunds SET razorpay_refund_id = COALESCE($2, razorpay_refund_id), status = $3,
       speed_processed = COALESCE($4, speed_processed), failure_code = $5, failure_message = $6,
       arn = COALESCE($7, arn), raw_response = $8, processed_at = CASE WHEN $3 = 'processed' THEN COALESCE(processed_at, NOW()) ELSE processed_at END,
       updated_at = NOW() WHERE id = $1 RETURNING *`,
    [refundId, providerRefund?.id || null, status, providerRefund?.speed_processed || null,
      failure?.code || null, failure?.description || failure?.message || null,
      providerRefund?.acquirer_data?.arn || providerRefund?.acquirer_data?.rrn || null, providerRefund || failure || {}]
  );
  if (rows.length) await recalculatePaymentStatus(rows[0].order_id);
  return rows[0] || null;
};

const setRefundQuantities = async (returnId, selections) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const selection of selections) {
      const result = await client.query(
        `UPDATE return_items SET refund_quantity = $3, updated_at = NOW()
         WHERE id = $1 AND return_request_id = $2
           AND $3 >= 0 AND $3 <= GREATEST(0,
             CASE WHEN accepted_quantity > 0 THEN accepted_quantity WHEN approved_quantity > 0 THEN approved_quantity ELSE quantity END
             - replacement_quantity)
         RETURNING id`, [selection.id, returnId, selection.quantity]
      );
      if (!result.rowCount) { const error = new Error('Invalid refund quantity'); error.statusCode = 400; throw error; }
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
};

const findRefundByProviderId = (providerId) => db.query(`SELECT * FROM payment_refunds WHERE razorpay_refund_id = $1`, [providerId]);
const getRefundById = (id) => db.query(`SELECT * FROM payment_refunds WHERE id = $1`, [id]);
const getPendingRefunds = () => db.query(`SELECT * FROM payment_refunds WHERE status IN ('creating', 'pending') AND razorpay_refund_id IS NOT NULL ORDER BY updated_at LIMIT 100`);
const recordWebhook = (eventId, type, refundId, payload) => db.query(
  `INSERT INTO refund_webhook_events (event_id, event_type, razorpay_refund_id, payload)
   VALUES ($1, $2, $3, $4) ON CONFLICT (event_id) DO NOTHING RETURNING id`, [eventId, type, refundId || null, payload || {}]
);

const createReplacement = async (returnId, items, actorId) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of items) {
      const { rows } = await client.query(
        `SELECT ri.*, oi.product_id FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
         WHERE ri.id = $1 AND ri.return_request_id = $2 FOR UPDATE`, [item.id, returnId]
      );
      const maximum = Number(rows[0]?.accepted_quantity || rows[0]?.approved_quantity || 0) - Number(rows[0]?.refund_quantity || 0);
      if (!rows.length || item.quantity <= 0 || item.quantity > maximum) { const error = new Error('Invalid replacement quantity'); error.statusCode = 400; throw error; }
      const existing = await client.query('SELECT id FROM replacement_allocations WHERE return_item_id = $1', [item.id]);
      if (existing.rowCount) {
        const { rows: allocationRows } = await client.query('SELECT quantity FROM replacement_allocations WHERE return_item_id = $1', [item.id]);
        if (Number(allocationRows[0].quantity) !== Number(item.quantity)) { const error = new Error('Replacement inventory is already allocated with a different quantity'); error.statusCode = 409; throw error; }
      } else {
        const stock = await client.query('UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2 AND stock >= $1 RETURNING id', [item.quantity, rows[0].product_id]);
        if (!stock.rowCount) { const error = new Error('Insufficient stock for replacement'); error.statusCode = 409; throw error; }
        await client.query('INSERT INTO replacement_allocations (return_item_id, quantity, allocated_by) VALUES ($1, $2, $3)', [item.id, item.quantity, actorId]);
        await client.query('UPDATE return_items SET replacement_quantity = $2, updated_at = NOW() WHERE id = $1', [item.id, item.quantity]);
      }
    }
    await client.query("UPDATE return_requests SET resolution_type = 'replacement', status = 'resolution_pending', updated_at = NOW() WHERE id = $1", [returnId]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
};

module.exports = {
  getOrderContext, createRequest, getDetailed, listForOrders, attachReturns, listAdmin,
  transition, approveItems, inspectItems, reserveRefund, updateRefund, recalculatePaymentStatus,
  findRefundByProviderId, getRefundById, getPendingRefunds, recordWebhook, createReplacement,
  setRefundQuantities,
};
