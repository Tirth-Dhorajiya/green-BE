const crypto = require('crypto');
const orderModel = require('../models/orderModel');
const returnModel = require('../models/returnModel');
const shippingModel = require('../models/shippingModel');
const delhivery = require('../services/delhiveryService');
const razorpayRefunds = require('../services/razorpayRefundService');
const { allocateNetUnitAmounts, evaluateItemEligibility, refundableAmountForQuantity } = require('../services/returnPolicyService');
const { sendReturnEmail } = require('../services/emailService');

const featureEnabled = () => process.env.RETURNS_ENABLED === 'true';
const notify = async (returnId, type, note) => {
  const request = await returnModel.getDetailed(returnId);
  if (!request?.customer_email) return;
  sendReturnEmail({ to: request.customer_email, request, type, note }).catch((error) => console.error('Return email failed', error));
};

const finishRefundResolution = async (returnId, actorId, note) => {
  const request = await returnModel.getDetailed(returnId);
  const replacementPending = request.shipments.some((shipment) => shipment.purpose === 'replacement' && !['delivered', 'cancelled', 'failed'].includes(shipment.status));
  const replacementUsed = request.items.some((item) => Number(item.replacement_quantity) > 0);
  return returnModel.transition(returnId, replacementPending ? 'resolution_pending' : 'resolved', {
    actorId,
    note,
    fields: {
      resolution_type: replacementUsed ? 'mixed' : 'refund',
      ...(replacementPending ? {} : { resolved_at: new Date() }),
    },
  });
};

const uploadEvidence = (req, res) => {
  if (!featureEnabled()) return res.status(503).json({ success: false, message: 'Online returns are not enabled yet' });
  return res.status(201).json({
    success: true,
    evidence: (req.files || []).map((file) => ({ url: file.path, publicId: file.public_id || file.filename, kind: 'product' })),
  });
};

const createReturn = async (req, res, next) => {
  try {
    if (!featureEnabled()) return res.status(503).json({ success: false, message: 'Online returns are not enabled yet' });
    const { rows } = await returnModel.getOrderContext(req.params.orderId, req.user.id);
    const order = rows[0];
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'delivered' || !order.delivered_at) return res.status(409).json({ success: false, message: 'Returns are available after delivery' });
    if (!['paid', 'partially_refunded'].includes(order.payment_status)) return res.status(409).json({ success: false, message: 'This payment is not eligible for a return' });

    const evidence = Array.isArray(req.body.evidence) ? req.body.evidence : [];
    if (evidence.length > 5 || evidence.some((item) => !/^https:\/\//i.test(String(item.url || '')))) {
      return res.status(400).json({ success: false, message: 'Upload up to five valid evidence images' });
    }
    const allocated = allocateNetUnitAmounts({ items: order.items, subtotal: order.subtotal_price, discount: order.discount_amount });
    const normalized = [];
    let needsEvidence = false;
    for (const requested of req.body.items) {
      const item = allocated.find((candidate) => candidate.id === requested.order_item_id);
      if (!item || requested.quantity > Number(item.quantity)) return res.status(400).json({ success: false, message: 'Invalid return item or quantity' });
      const eligibility = evaluateItemEligibility({ item, reason: requested.reason, deliveredAt: order.delivered_at });
      if (!eligibility.eligible) return res.status(422).json({ success: false, message: `${item.product_name}: ${eligibility.message}` });
      needsEvidence ||= eligibility.evidenceRequired;
      normalized.push({
        orderItemId: item.id,
        quantity: Number(requested.quantity),
        reason: requested.reason,
        amountPaise: refundableAmountForQuantity({ ...item, net_line_paise: item.netLinePaise }, requested.quantity),
        reverseRequired: eligibility.reverseRequired,
      });
    }
    if (needsEvidence && evidence.length < 2) return res.status(400).json({ success: false, message: 'Add at least two photos showing the product and packaging' });
    const returnId = await returnModel.createRequest({
      order,
      userId: req.user.id,
      preferredResolution: req.body.preferred_resolution,
      explanation: req.body.explanation,
      items: normalized,
      evidence,
    });
    await notify(returnId, 'requested');
    res.status(201).json({ success: true, message: 'Return request submitted', return: await returnModel.getDetailed(returnId, { userId: req.user.id }) });
  } catch (error) { next(error); }
};

const listMyReturns = async (req, res, next) => {
  try {
    const { rows: orders } = await orderModel.getOrdersByUser(req.user.id);
    const returns = await returnModel.listForOrders(orders.map((order) => order.id), req.user.id);
    res.json({ success: true, returns });
  } catch (error) { next(error); }
};

const getReturn = async (req, res, next) => {
  try {
    const request = await returnModel.getDetailed(req.params.returnId, { userId: req.user.role === 'admin' ? null : req.user.id });
    if (!request) return res.status(404).json({ success: false, message: 'Return request not found' });
    res.json({ success: true, return: request });
  } catch (error) { next(error); }
};

const cancelReturn = async (req, res, next) => {
  try {
    const request = await returnModel.getDetailed(req.params.returnId, { userId: req.user.id });
    if (!request) return res.status(404).json({ success: false, message: 'Return request not found' });
    if (!['requested', 'approved'].includes(request.status) || request.shipments.length) {
      return res.status(409).json({ success: false, message: 'This return can no longer be withdrawn' });
    }
    await returnModel.transition(request.id, 'cancelled', { actorId: req.user.id, note: req.body.note || 'Withdrawn by customer', fields: { cancelled_at: new Date() } });
    await notify(request.id, 'cancelled');
    res.json({ success: true, message: 'Return request withdrawn', return: await returnModel.getDetailed(request.id, { userId: req.user.id }) });
  } catch (error) { next(error); }
};

const listAdminReturns = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const { rows } = await returnModel.listAdmin({ status: req.query.status, search: req.query.search, limit, offset: (page - 1) * limit });
    const totalCount = rows.length ? Number(rows[0].total_count) : 0;
    res.json({ success: true, page, limit, totalCount, totalPages: Math.ceil(totalCount / limit), returns: rows.map(({ total_count, ...item }) => item) });
  } catch (error) { next(error); }
};

const decideReturn = async (req, res, next) => {
  try {
    const request = await returnModel.getDetailed(req.params.returnId);
    if (!request) return res.status(404).json({ success: false, message: 'Return request not found' });
    if (request.status !== 'requested') return res.status(409).json({ success: false, message: 'This return has already been reviewed' });
    if (req.body.decision === 'rejected') {
      await returnModel.transition(request.id, 'rejected', { actorId: req.user.id, note: req.body.reason, fields: { admin_reason: req.body.reason, resolution_type: 'none' } });
      await notify(request.id, 'rejected', req.body.reason);
      return res.json({ success: true, message: 'Return rejected', return: await returnModel.getDetailed(request.id) });
    }
    const approvals = req.body.items?.length
      ? req.body.items
      : request.items.map((item) => ({ id: item.id, approved_quantity: item.quantity }));
    await returnModel.approveItems(request.id, approvals);
    const reverseRequired = req.body.reverse_required ?? request.reverse_required;
    const nextStatus = reverseRequired ? 'approved' : 'resolution_pending';
    await returnModel.transition(request.id, nextStatus, {
      actorId: req.user.id,
      note: req.body.reason || 'Return approved',
      fields: {
        admin_reason: req.body.reason || null,
        reverse_required: reverseRequired,
        manual_return: req.body.manual_return === true,
        approved_by: req.user.id,
        approved_at: new Date(),
        inspection_status: reverseRequired ? 'pending' : 'waived',
      },
    });
    await notify(request.id, 'approved', req.body.reason);
    res.json({ success: true, message: 'Return approved', return: await returnModel.getDetailed(request.id) });
  } catch (error) { next(error); }
};

const createReverseShipment = async (req, res, next) => {
  let shipmentId;
  try {
    const request = await returnModel.getDetailed(req.params.returnId);
    if (!request) return res.status(404).json({ success: false, message: 'Return request not found' });
    if (!request.reverse_required || !['approved', 'reverse_pending', 'exception'].includes(request.status)) {
      return res.status(409).json({ success: false, message: 'This return is not eligible for a reverse shipment' });
    }
    const serviceability = await delhivery.checkReverseServiceability(request.shipping_address?.postalCode);
    if (!serviceability.serviceable) return res.status(422).json({ success: false, message: serviceability.remarks || 'Reverse pickup is unavailable for this postal code' });
    const config = delhivery.getConfig();
    const reference = `GRNR${request.id.replace(/-/g, '').slice(0, 18)}${Date.now().toString(36)}`.slice(0, 50);
    const draft = await shippingModel.createDraft({
      orderId: request.order_id,
      providerReference: reference,
      pickupLocation: config.pickupLocation,
      packages: req.body.packages,
      createdBy: req.user.id,
      direction: 'reverse',
      purpose: 'return',
      returnRequestId: request.id,
    });
    shipmentId = draft.shipmentId;
    if (!draft.existing) {
      let shipment = await shippingModel.getById(shipmentId);
      await shippingModel.assignWaybills(shipmentId, await delhivery.fetchWaybills(shipment.packages.length));
      shipment = await shippingModel.getById(shipmentId);
      const response = await delhivery.manifestReverseShipments({ order: { ...request, user_name: request.customer_name }, packages: shipment.packages, providerReference: reference });
      await shippingModel.markManifested(shipmentId, response);
      await returnModel.transition(request.id, 'reverse_pending', { actorId: req.user.id, note: 'Delhivery reverse AWB created' });
      await notify(request.id, 'reverse_created');
    }
    res.status(draft.existing ? 200 : 201).json({ success: true, message: draft.existing ? 'Active reverse shipment already exists' : 'Reverse shipment created', return: await returnModel.getDetailed(request.id) });
  } catch (error) {
    if (shipmentId) await shippingModel.markFailed(shipmentId, error.message, error.details || {}).catch(() => null);
    next(error);
  }
};

const markManualReturn = async (req, res, next) => {
  try {
    const request = await returnModel.getDetailed(req.params.returnId);
    if (!request || !['approved', 'reverse_pending', 'exception'].includes(request.status)) return res.status(409).json({ success: false, message: 'This return cannot use manual shipping' });
    if (request.shipments.some((shipment) => shipment.direction === 'reverse' && ['manifested', 'in_transit', 'returned'].includes(shipment.status))) return res.status(409).json({ success: false, message: 'A Delhivery reverse shipment is already active' });
    await returnModel.transition(request.id, 'approved', { actorId: req.user.id, note: req.body.note || 'Manual return shipping selected', fields: { manual_return: true, reverse_required: true } });
    res.json({ success: true, message: 'Manual return enabled; record inspection after the parcel arrives', return: await returnModel.getDetailed(request.id) });
  } catch (error) { next(error); }
};

const inspectReturn = async (req, res, next) => {
  try {
    await returnModel.inspectItems(req.params.returnId, req.body.items, req.user.id);
    await notify(req.params.returnId, 'inspected');
    res.json({ success: true, message: 'Inspection recorded', return: await returnModel.getDetailed(req.params.returnId) });
  } catch (error) { next(error); }
};

const callRefund = async (refund) => {
  try {
    const provider = await razorpayRefunds.createRefund({
      paymentId: refund.razorpay_payment_id,
      amountPaise: Number(refund.amount_paise),
      receipt: refund.receipt,
      idempotencyKey: refund.idempotency_key,
      notes: { order_id: refund.order_id, return_request_id: refund.return_request_id || 'cancellation' },
    });
    return returnModel.updateRefund(refund.id, provider);
  } catch (error) {
    const ambiguous = error.statusCode >= 500 || /timed out|duplicate|in progress|temporarily unavailable/i.test(error.message);
    if (ambiguous) {
      try {
        const collection = await razorpayRefunds.getPaymentRefunds(refund.razorpay_payment_id);
        const recovered = collection.items?.find((item) => item.receipt === refund.receipt);
        if (recovered) return returnModel.updateRefund(refund.id, recovered);
      } catch {
        // Keep the refund pending and retry the same idempotency key later.
      }
    }
    await returnModel.updateRefund(refund.id, {}, { ...(error.details || {}), message: error.message, ambiguous });
    throw error;
  }
};

const initiateReturnRefund = async (req, res, next) => {
  try {
    const request = await returnModel.getDetailed(req.params.returnId);
    if (!request) return res.status(404).json({ success: false, message: 'Return request not found' });
    if (!['resolution_pending', 'received', 'exception'].includes(request.status)) return res.status(409).json({ success: false, message: 'This return is not ready for a refund' });
    if (request.refunds.some((refund) => ['creating', 'pending', 'processed'].includes(refund.status))) return res.status(409).json({ success: false, message: 'A refund already exists for this return request' });
    const selections = req.body.items?.length
      ? req.body.items
      : request.items.map((item) => ({ id: item.id, quantity: item.accepted_quantity || item.approved_quantity || item.quantity }));
    let amountPaise = 0;
    for (const selection of selections) {
      const item = request.items.find((candidate) => candidate.id === selection.id);
      const maxQuantity = Number(item?.accepted_quantity || item?.approved_quantity || 0) - Number(item?.replacement_quantity || 0);
      if (!item || selection.quantity <= 0 || selection.quantity > maxQuantity) return res.status(400).json({ success: false, message: 'Invalid refund quantity' });
      amountPaise += Math.floor(Number(item.requested_amount_paise) * Number(selection.quantity) / Number(item.quantity));
    }
    await returnModel.setRefundQuantities(request.id, selections);
    const refund = await returnModel.reserveRefund({ orderId: request.order_id, returnRequestId: request.id, paymentId: request.razorpay_payment_id, amountPaise, actorId: req.user.id });
    const updated = await callRefund(refund);
    const completed = updated.status === 'processed';
    if (completed) await finishRefundResolution(request.id, req.user.id, `Razorpay refund ${updated.razorpay_refund_id || updated.receipt} processed`);
    else await returnModel.transition(request.id, 'resolution_pending', { actorId: req.user.id, note: `Razorpay refund ${updated.razorpay_refund_id || updated.receipt} initiated`, fields: { resolution_type: request.items.some((item) => Number(item.replacement_quantity) > 0) ? 'mixed' : 'refund' } });
    await notify(request.id, completed ? 'refund_processed' : 'refund_pending');
    res.status(201).json({ success: true, message: 'Refund initiated', refund: updated, return: await returnModel.getDetailed(request.id) });
  } catch (error) { next(error); }
};

const retryRefund = async (req, res, next) => {
  try {
    const { rows } = await returnModel.getRefundById(req.params.refundId);
    const failed = rows[0];
    if (!failed || !['failed', 'pending', 'creating'].includes(failed.status)) return res.status(409).json({ success: false, message: 'This refund cannot be retried' });
    if (failed.status !== 'failed' && failed.razorpay_refund_id) return res.status(409).json({ success: false, message: 'Refresh this refund instead of retrying it' });
    const refund = failed.status === 'failed'
      ? await returnModel.reserveRefund({ orderId: failed.order_id, returnRequestId: failed.return_request_id, paymentId: failed.razorpay_payment_id, amountPaise: Number(failed.amount_paise), actorId: req.user.id, parentRefundId: failed.id })
      : failed;
    const updated = await callRefund(refund);
    if (failed.return_request_id) await notify(failed.return_request_id, 'refund_pending');
    res.status(201).json({ success: true, message: 'Refund retried', refund: updated });
  } catch (error) { next(error); }
};

const refreshRefund = async (req, res, next) => {
  try {
    const { rows } = await returnModel.getRefundById(req.params.refundId);
    const refund = rows[0];
    if (!refund?.razorpay_refund_id) return res.status(404).json({ success: false, message: 'Razorpay refund reference is unavailable' });
    const updated = await returnModel.updateRefund(refund.id, await razorpayRefunds.getRefund(refund.razorpay_refund_id));
    if (updated.status === 'processed' && updated.return_request_id) {
      await finishRefundResolution(updated.return_request_id, req.user.id, 'Refund processed');
      await notify(updated.return_request_id, 'refund_processed');
    }
    res.json({ success: true, message: 'Refund refreshed', refund: updated });
  } catch (error) { next(error); }
};

const linkExternalRefund = async (req, res, next) => {
  try {
    const { rows } = await orderModel.getOrderById(req.body.order_id);
    const order = rows[0];
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    const provider = await razorpayRefunds.getRefund(req.body.razorpay_refund_id);
    if (provider.payment_id !== order.razorpay_payment_id) return res.status(409).json({ success: false, message: 'The Razorpay refund does not belong to this order payment' });
    const reserved = await returnModel.reserveRefund({
      orderId: order.id,
      returnRequestId: req.body.return_request_id || null,
      paymentId: order.razorpay_payment_id,
      amountPaise: Number(provider.amount),
      actorId: req.user.id,
    });
    const refund = await returnModel.updateRefund(reserved.id, provider);
    if (refund.return_request_id && refund.status === 'processed') {
      await finishRefundResolution(refund.return_request_id, req.user.id, 'Verified Razorpay Dashboard refund linked');
      await notify(refund.return_request_id, 'refund_processed');
    }
    res.status(201).json({ success: true, message: 'Verified Razorpay refund linked', refund });
  } catch (error) { next(error); }
};

const createReplacement = async (req, res, next) => {
  let shipmentId;
  try {
    const request = await returnModel.getDetailed(req.params.returnId);
    if (!request || !['resolution_pending', 'received', 'approved', 'exception'].includes(request.status)) return res.status(409).json({ success: false, message: 'This return is not ready for replacement' });
    await returnModel.createReplacement(request.id, req.body.items, req.user.id);
    const config = delhivery.getConfig();
    const reference = `GRNX${request.id.replace(/-/g, '').slice(0, 18)}${Date.now().toString(36)}`.slice(0, 50);
    const draft = await shippingModel.createDraft({ orderId: request.order_id, providerReference: reference, pickupLocation: config.pickupLocation, packages: req.body.packages, createdBy: req.user.id, purpose: 'replacement', returnRequestId: request.id });
    shipmentId = draft.shipmentId;
    if (!draft.existing) {
      let shipment = await shippingModel.getById(shipmentId);
      await shippingModel.assignWaybills(shipmentId, await delhivery.fetchWaybills(shipment.packages.length));
      shipment = await shippingModel.getById(shipmentId);
      await shippingModel.markManifested(shipmentId, await delhivery.manifestShipments({ order: { ...request, items: request.items, user_name: request.customer_name }, packages: shipment.packages, providerReference: reference }));
    }
    await notify(request.id, 'replacement_created');
    res.status(draft.existing ? 200 : 201).json({ success: true, message: 'Replacement shipment created', return: await returnModel.getDetailed(request.id) });
  } catch (error) {
    if (shipmentId) await shippingModel.markFailed(shipmentId, error.message, error.details || {}).catch(() => null);
    next(error);
  }
};

const handleRazorpayWebhook = async (req, res, next) => {
  try {
    if (!razorpayRefunds.verifyWebhook(req.rawBody, req.headers['x-razorpay-signature'])) return res.status(401).json({ success: false, message: 'Invalid Razorpay signature' });
    const eventType = req.body.event;
    const entity = req.body.payload?.refund?.entity;
    if (!entity?.id || !eventType?.startsWith('refund.')) return res.status(202).json({ success: true, message: 'Event ignored' });
    const eventId = req.headers['x-razorpay-event-id'] || crypto.createHash('sha256').update(req.rawBody).digest('hex');
    const recorded = await returnModel.recordWebhook(eventId, eventType, entity.id, req.body);
    if (!recorded.rowCount) return res.json({ success: true, duplicate: true });
    const { rows } = await returnModel.findRefundByProviderId(entity.id);
    if (!rows.length) return res.status(202).json({ success: true, message: 'Unknown refund ignored' });
    const updated = await returnModel.updateRefund(rows[0].id, entity);
    if (updated.return_request_id && updated.status === 'processed') {
      await finishRefundResolution(updated.return_request_id, null, 'Razorpay refund processed');
      await notify(updated.return_request_id, 'refund_processed');
    } else if (updated.return_request_id && updated.status === 'failed') await notify(updated.return_request_id, 'refund_failed', updated.failure_message);
    res.json({ success: true });
  } catch (error) { next(error); }
};

const reconcileRefunds = async (req, res, next) => {
  try {
    const expected = `Bearer ${process.env.CRON_SECRET || ''}`;
    const provided = String(req.headers.authorization || '');
    if (!process.env.CRON_SECRET || provided.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { rows } = await returnModel.getPendingRefunds();
    const results = [];
    for (const refund of rows) {
      try {
        const updated = refund.razorpay_refund_id
          ? await returnModel.updateRefund(refund.id, await razorpayRefunds.getRefund(refund.razorpay_refund_id))
          : await callRefund(refund);
        results.push({ id: refund.id, success: true, refund: updated });
      }
      catch (error) { results.push({ id: refund.id, success: false, message: error.message }); }
    }
    res.json({ success: true, processed: results.length, results });
  } catch (error) { next(error); }
};

module.exports = {
  uploadEvidence, createReturn, listMyReturns, getReturn, cancelReturn, listAdminReturns,
  decideReturn, createReverseShipment, inspectReturn, initiateReturnRefund, retryRefund,
  refreshRefund, createReplacement, handleRazorpayWebhook, reconcileRefunds, callRefund,
  linkExternalRefund,
  markManualReturn,
};
