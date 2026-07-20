const crypto = require('crypto');
const orderModel = require('../models/orderModel');
const shippingModel = require('../models/shippingModel');
const delhivery = require('../services/delhiveryService');
const { sendOrderEmail } = require('../services/emailService');
const returnModel = require('../models/returnModel');
const { callRefund } = require('./returnController');

const notifyOrderTransition = async (orderId, previousStatus, nextStatus, type = 'status') => {
  if (previousStatus === nextStatus && type !== 'tracking') return;
  const { rows } = await orderModel.getOrderById(orderId);
  const order = rows[0];
  if (!order?.user_email) return;
  sendOrderEmail({ to: order.user_email, order, type }).catch((error) => {
    console.error('Shipping notification failed', error);
  });
};

const applyTrackingEvent = async (waybill, event, estimatedDeliveryDate) => {
  if (!waybill) return null;
  const normalizedStatus = delhivery.normalizeTrackingStatus(event.status, event.statusCode, event.instructions, event.statusType);
  return shippingModel.recordTrackingEvent({
    waybill,
    event,
    eventKey: delhivery.eventKey(event),
    normalizedStatus,
    estimatedDeliveryDate,
  });
};

const refundCompletedRto = async (aggregate) => {
  if (aggregate?.shipmentStatus !== 'returned' || aggregate.orderStatus !== 'cancelled') return;
  const { rows } = await orderModel.getOrderById(aggregate.orderId);
  const order = rows[0];
  if (!order || order.payment_status !== 'paid' || !order.razorpay_payment_id) return;
  try {
    const refund = await returnModel.reserveRefund({
      orderId: order.id,
      paymentId: order.razorpay_payment_id,
      amountPaise: Math.round(Number(order.total_price) * 100),
    });
    await callRefund(refund);
  } catch (error) {
    if (!/exceeds the remaining/i.test(error.message)) console.error('Automatic RTO refund failed', error.message);
  }
};

const applyTrackingRecords = async (records) => {
  const shipmentIds = new Set();
  for (const record of records) {
    const events = [...(record.scans || []), { ...record.current, raw: record.raw }];
    for (const event of events) {
      const result = await applyTrackingEvent(record.waybill, event, record.current?.estimatedDeliveryDate);
      if (result?.shipmentId) shipmentIds.add(result.shipmentId);
    }
  }

  const aggregates = [];
  for (const shipmentId of shipmentIds) {
    const aggregate = await shippingModel.aggregateShipment(shipmentId);
    if (aggregate) {
      aggregates.push(aggregate);
      await notifyOrderTransition(aggregate.orderId, aggregate.previousOrderStatus, aggregate.orderStatus);
      await refundCompletedRto(aggregate);
    }
  }
  return aggregates;
};

const checkServiceability = async (req, res, next) => {
  try {
    const result = await delhivery.checkServiceability(req.query.postalCode);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

const createShipment = async (req, res, next) => {
  let shipmentId;
  try {
    const { rows } = await orderModel.getOrderById(req.params.id);
    const order = rows[0];
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.payment_status !== 'paid') return res.status(409).json({ success: false, message: 'Only paid orders can be shipped' });
    if (!['pending', 'processing'].includes(order.status)) {
      return res.status(409).json({ success: false, message: 'This order is not eligible for a new shipment' });
    }
    if (Number(order.total_price) >= 50000 && !req.body.ewaybill_number) {
      return res.status(400).json({ success: false, message: 'A 12-digit e-waybill number is required for orders of ₹50,000 or more' });
    }

    const address = order.shipping_address || {};
    const requiredAddress = ['name', 'phone', 'address', 'city', 'state', 'postalCode'];
    if (requiredAddress.some((field) => !address[field])) {
      return res.status(400).json({ success: false, message: 'Complete customer shipping address is required' });
    }
    const serviceability = await delhivery.checkServiceability(address.postalCode);
    if (!serviceability.serviceable) {
      return res.status(422).json({ success: false, message: 'Delhivery prepaid delivery is not available for this postal code' });
    }

    const config = delhivery.getConfig();
    const providerReference = `GRN${order.id.replace(/-/g, '').slice(0, 16)}${Date.now().toString(36)}`.slice(0, 50);
    const draft = await shippingModel.createDraft({
      orderId: order.id,
      providerReference,
      pickupLocation: config.pickupLocation,
      ewaybillNumber: req.body.ewaybill_number,
      packages: req.body.packages,
      createdBy: req.user.id,
    });
    shipmentId = draft.shipmentId;
    if (draft.existing) {
      const shipment = await shippingModel.getById(shipmentId);
      return res.status(200).json({ success: true, message: 'An active shipment already exists', shipment });
    }

    let shipment = await shippingModel.getById(shipmentId);
    const waybills = await delhivery.fetchWaybills(shipment.packages.length);
    await shippingModel.assignWaybills(shipmentId, waybills);
    shipment = await shippingModel.getById(shipmentId);
    const response = await delhivery.manifestShipments({
      order,
      packages: shipment.packages,
      providerReference: shipment.provider_reference,
      ewaybillNumber: shipment.ewaybill_number,
    });
    await shippingModel.markManifested(shipmentId, response);
    const aggregate = await shippingModel.aggregateShipment(shipmentId);
    await notifyOrderTransition(order.id, order.status, aggregate?.orderStatus || 'processing', 'tracking');
    shipment = await shippingModel.getById(shipmentId);
    res.status(201).json({ success: true, message: 'Delhivery shipment created', shipment });
  } catch (error) {
    if (shipmentId) {
      try {
        const shipment = await shippingModel.getById(shipmentId);
        const recovery = await delhivery.getTracking({ reference: shipment?.provider_reference });
        const records = delhivery.parseTrackingPayload(recovery);
        if (records.length) {
          await shippingModel.markManifested(shipmentId, recovery);
          await applyTrackingRecords(records);
          return res.status(201).json({ success: true, message: 'Delhivery shipment recovered after provider retry', shipment: await shippingModel.getById(shipmentId) });
        }
      } catch {
        // Recovery is best effort; retain the original provider error.
      }
      await shippingModel.markFailed(shipmentId, error.message, error.details || {});
    }
    next(error);
  }
};

const syncShipmentById = async (shipmentId) => {
  const shipment = await shippingModel.getById(shipmentId);
  if (!shipment) {
    const error = new Error('Shipment not found');
    error.statusCode = 404;
    throw error;
  }
  const waybills = shipment.packages.map((pkg) => pkg.waybill).filter(Boolean);
  if (!waybills.length) {
    const error = new Error('Shipment does not have allocated waybills');
    error.statusCode = 409;
    throw error;
  }
  const payload = await delhivery.getTracking({ waybills });
  await applyTrackingRecords(delhivery.parseTrackingPayload(payload));
  return shippingModel.getById(shipmentId);
};

const syncShipment = async (req, res, next) => {
  try {
    const shipment = await syncShipmentById(req.params.shipmentId);
    res.json({ success: true, message: 'Tracking synchronized', shipment });
  } catch (error) {
    next(error);
  }
};

const cancelShipmentById = async (shipmentId) => {
  const shipment = await shippingModel.getById(shipmentId);
  if (!shipment) {
    const error = new Error('Shipment not found');
    error.statusCode = 404;
    throw error;
  }
  if (shipment.packages.some((pkg) => pkg.status === 'delivered')) {
    const error = new Error('Delivered packages cannot be cancelled');
    error.statusCode = 409;
    throw error;
  }
  for (const pkg of shipment.packages.filter((item) => item.waybill && item.status !== 'cancelled')) {
    await delhivery.cancelPackage(pkg.waybill);
  }
  await shippingModel.markPackagesCancelled(shipmentId);
  const aggregate = await shippingModel.aggregateShipment(shipmentId);
  if (aggregate) await notifyOrderTransition(aggregate.orderId, aggregate.previousOrderStatus, aggregate.orderStatus, 'cancelled');
  return shippingModel.getById(shipmentId);
};

const cancelActiveShipmentForOrder = async (orderId) => {
  const { rows } = await shippingModel.getActiveByOrder(orderId);
  if (!rows.length) return null;
  return cancelShipmentById(rows[0].id);
};

const cancelShipment = async (req, res, next) => {
  try {
    const shipment = await cancelShipmentById(req.params.shipmentId);
    res.json({ success: true, message: 'Delhivery shipment cancelled', shipment });
  } catch (error) {
    next(error);
  }
};

const getLabel = async (req, res, next) => {
  try {
    const { rows } = await shippingModel.getPackageById(req.params.packageId, req.params.shipmentId);
    const pkg = rows[0];
    if (!pkg?.waybill) return res.status(404).json({ success: false, message: 'Shipment package not found' });
    const label = await delhivery.getLabel(pkg.waybill);
    if (label.buffer) {
      res.setHeader('Content-Type', label.contentType || 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="delhivery-${pkg.waybill}.pdf"`);
      return res.send(label.buffer);
    }
    const labelUrl = label.data?.pdf_download_link || label.data?.packages?.[0]?.pdf_download_link || label.data?.url;
    if (!labelUrl) return res.status(502).json({ success: false, message: 'Delhivery label is not available yet' });
    const document = await delhivery.downloadDocument(labelUrl);
    res.setHeader('Content-Type', document.contentType);
    res.setHeader('Content-Disposition', `inline; filename="delhivery-${pkg.waybill}.pdf"`);
    res.send(document.buffer);
  } catch (error) {
    next(error);
  }
};

const schedulePickup = async (req, res, next) => {
  try {
    const config = delhivery.getConfig();
    const { rows: openPickups } = await shippingModel.getOpenPickupRequest(config.pickupLocation);
    if (openPickups.length) {
      return res.status(409).json({ success: false, message: 'A pickup request is already scheduled for this warehouse', pickup: openPickups[0] });
    }
    const response = await delhivery.createPickup({
      pickupDate: req.body.pickup_date,
      pickupTime: req.body.pickup_time,
      expectedPackageCount: Number(req.body.expected_package_count),
    });
    const providerPickupId = response?.pickup_id || response?.pickup_request_id || response?.pr_exist || null;
    const { rows } = await shippingModel.createPickupRequest({
      providerPickupId,
      pickupLocation: config.pickupLocation,
      pickupDate: req.body.pickup_date,
      pickupTime: req.body.pickup_time,
      expectedPackageCount: Number(req.body.expected_package_count),
      createdBy: req.user.id,
      response,
    });
    res.status(201).json({ success: true, message: 'Delhivery pickup scheduled', pickup: rows[0] });
  } catch (error) {
    next(error);
  }
};

const listPickups = async (_req, res, next) => {
  try {
    const { rows } = await shippingModel.getPickupRequests();
    res.json({ success: true, pickups: rows });
  } catch (error) {
    next(error);
  }
};

const updatePickupStatus = async (req, res, next) => {
  try {
    const { rows } = await shippingModel.updatePickupStatus(req.params.pickupId, req.body.status);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Pickup request not found' });
    res.json({ success: true, message: `Pickup marked ${req.body.status}`, pickup: rows[0] });
  } catch (error) {
    next(error);
  }
};

const safeSecretMatch = (provided, expected) => {
  if (!provided || !expected) return false;
  const left = Buffer.from(String(provided));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const handleWebhook = async (req, res, next) => {
  try {
    if (!safeSecretMatch(req.headers['x-delhivery-webhook-secret'], process.env.DELHIVERY_WEBHOOK_SECRET)) {
      return res.status(401).json({ success: false, message: 'Invalid webhook secret' });
    }
    const event = delhivery.parseWebhookPayload(req.body);
    if (!event.waybill) return res.status(400).json({ success: false, message: 'Webhook waybill is required' });
    const result = await applyTrackingEvent(event.waybill, event, event.estimatedDeliveryDate);
    if (!result) return res.status(202).json({ success: true, message: 'Unknown waybill ignored' });
    const aggregate = await shippingModel.aggregateShipment(result.shipmentId);
    if (aggregate) {
      await notifyOrderTransition(aggregate.orderId, aggregate.previousOrderStatus, aggregate.orderStatus);
      await refundCompletedRto(aggregate);
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

const reconcileShipments = async (req, res, next) => {
  try {
    const auth = req.headers.authorization;
    if (!process.env.CRON_SECRET || !safeSecretMatch(auth, `Bearer ${process.env.CRON_SECRET}`)) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const { rows } = await shippingModel.getReconcileShipments();
    const results = [];
    for (const shipment of rows) {
      try {
        await syncShipmentById(shipment.id);
        results.push({ id: shipment.id, success: true });
      } catch (error) {
        results.push({ id: shipment.id, success: false, message: error.message });
      }
    }
    res.json({ success: true, processed: results.length, results });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  checkServiceability,
  createShipment,
  syncShipment,
  cancelShipment,
  cancelActiveShipmentForOrder,
  getLabel,
  schedulePickup,
  listPickups,
  updatePickupStatus,
  handleWebhook,
  reconcileShipments,
  applyTrackingRecords,
};
