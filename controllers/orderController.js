const orderModel = require('../models/orderModel');
const cartModel = require('../models/cartModel');
const { sendOrderEmail } = require('../services/emailService');
const shippingModel = require('../models/shippingModel');
const { cancelActiveShipmentForOrder } = require('./shippingController');
const returnModel = require('../models/returnModel');
const { callRefund } = require('./returnController');

const notifyOrder = (order, type, note) => {
  if (!order?.user_email) return;
  sendOrderEmail({ to: order.user_email, order, type, note }).catch((err) => {
    console.error('Order notification failed', err);
  });
};

const initiateCancellationRefund = async (order, actorId) => {
  if (order?.payment_status !== 'paid' || !order.razorpay_payment_id) return null;
  const refund = await returnModel.reserveRefund({
    orderId: order.id,
    paymentId: order.razorpay_payment_id,
    amountPaise: Math.round(Number(order.total_price) * 100),
    actorId,
  });
  return callRefund(refund);
};

// POST /api/orders  — create order from cart
const createOrder = async (req, res, next) => {
  try {
    const { rows: cartItems } = await cartModel.getCartByUser(req.user.id);

    if (!cartItems.length) {
      return res.status(400).json({ success: false, message: 'Cart is empty' });
    }

    // Check stock for all items
    for (const item of cartItems) {
      if (item.stock < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for "${item.name}"`,
        });
      }
    }

    const items = cartItems.map((i) => ({
      product_id: i.product_id,
      quantity: i.quantity,
      price: parseFloat(i.price),
    }));

    const totalPrice = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

    const order = await orderModel.createOrder(req.user.id, totalPrice.toFixed(2), items, {
      shipping_address: req.body.shipping_address || {},
      payment_status: req.body.payment_status || 'pending',
      payment_provider: req.body.payment_provider || 'manual',
    });

    // Clear cart after successful order
    await cartModel.clearCart(req.user.id);

    const { rows } = await orderModel.getOrderById(order.id);
    notifyOrder(rows[0], 'placed');

    res.status(201).json({ success: true, message: 'Order placed successfully', order });
  } catch (err) {
    next(err);
  }
};

// GET /api/orders/my
const getUserOrders = async (req, res, next) => {
  try {
    const { rows } = await orderModel.getOrdersByUser(req.user.id);
    const orders = await shippingModel.attachShipments(rows);
    res.json({ success: true, orders: await returnModel.attachReturns(orders, req.user.id) });
  } catch (err) {
    next(err);
  }
};

// GET /api/orders/:id
const getOrderDetails = async (req, res, next) => {
  try {
    const { rows } = await orderModel.getOrderById(req.params.id);
    if (!rows.length || (rows[0].user_id !== req.user.id && req.user.role !== 'admin')) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    const [order] = await returnModel.attachReturns(await shippingModel.attachShipments([rows[0]]), req.user.role === 'admin' ? null : req.user.id);
    res.json({ success: true, order });
  } catch (err) {
    next(err);
  }
};

// GET /api/orders  (admin)
const getAllOrders = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      search,
      paymentStatus,
      couponStatus,
      sortBy = 'created_at',
      order = 'desc',
    } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    const { rows } = await orderModel.getAllOrders({
      limit: limitNum,
      offset,
      status,
      search,
      paymentStatus,
      couponStatus,
      sortBy,
      order,
    });

    const totalCount = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;
    const orders = await returnModel.attachReturns(
      await shippingModel.attachShipments(rows.map(({ total_count, ...o }) => o), { includeFailed: true })
    );

    res.json({
      success: true,
      page: pageNum,
      limit: limitNum,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
      orders,
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/orders/:id/status  (admin)
const updateOrderStatus = async (req, res, next) => {
  try {
    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    const {
      status,
      note,
      courier_name,
      tracking_number,
      estimated_delivery_date,
      admin_notes,
    } = req.body;

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const cancelledShipment = status === 'cancelled' ? await cancelActiveShipmentForOrder(req.params.id) : null;

    const { rows } = await orderModel.updateStatus(req.params.id, {
      status,
      changedBy: req.user.id,
      note,
      fulfillment: {
        courier_name,
        tracking_number,
        estimated_delivery_date,
        admin_notes,
      },
    });
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const { rows: detailRows } = await orderModel.getOrderById(req.params.id);
    const order = detailRows[0] || rows[0];
    let cancellationRefund = null;
    let refundWarning = null;
    if (status === 'cancelled') {
      try { cancellationRefund = await initiateCancellationRefund(order, req.user.id); }
      catch (error) { refundWarning = error.message; }
    }
    if (!cancelledShipment) {
      notifyOrder(order, tracking_number || courier_name ? 'tracking' : status === 'cancelled' ? 'cancelled' : 'status', note);
    }

    res.json({ success: true, message: refundWarning ? 'Order cancelled; refund needs admin attention' : 'Order status updated', order, refund: cancellationRefund, refundWarning });
  } catch (err) {
    next(err);
  }
};

// PUT /api/orders/:id/cancel
const cancelUserOrder = async (req, res, next) => {
  try {
    const { rows } = await orderModel.getOrderById(req.params.id);
    if (!rows.length || rows[0].user_id !== req.user.id) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const order = rows[0];
    if (!['pending', 'processing'].includes(order.status)) {
      return res.status(400).json({ success: false, message: 'Only pending or processing orders can be cancelled' });
    }

    const cancelledShipment = await cancelActiveShipmentForOrder(req.params.id);

    const { rows: updatedRows } = await orderModel.updateStatus(req.params.id, {
      status: 'cancelled',
      changedBy: req.user.id,
      note: req.body.note || 'Cancelled by customer',
    });

    const { rows: detailRows } = await orderModel.getOrderById(req.params.id);
    const updatedOrder = detailRows[0] || updatedRows[0];
    let cancellationRefund = null;
    let refundWarning = null;
    try { cancellationRefund = await initiateCancellationRefund(updatedOrder, req.user.id); }
    catch (error) { refundWarning = error.message; }
    if (!cancelledShipment) notifyOrder(updatedOrder, 'cancelled', 'Cancelled by customer');

    res.json({
      success: true,
      message: refundWarning ? 'Order cancelled. The refund needs admin attention.'
        : cancellationRefund ? 'Order cancelled and refund initiated.' : 'Order cancelled',
      order: updatedOrder,
      refund: cancellationRefund,
      refundWarning,
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/orders/:id/refund (admin, compatibility endpoint for cancelled orders)
const refundOrder = async (req, res, next) => {
  try {
    const { rows } = await orderModel.getOrderById(req.params.id);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const order = rows[0];
    if (order.status !== 'cancelled') {
      return res.status(400).json({ success: false, message: 'Only cancelled orders can be marked refunded' });
    }
    if (order.payment_status !== 'paid') {
      return res.status(400).json({ success: false, message: 'Only paid orders can be marked refunded' });
    }

    if (!order.razorpay_payment_id) {
      return res.status(409).json({ success: false, message: 'This order does not have a captured Razorpay payment reference' });
    }
    const refund = await returnModel.reserveRefund({
      orderId: order.id,
      paymentId: order.razorpay_payment_id,
      amountPaise: Math.round(Number(order.total_price) * 100),
      actorId: req.user.id,
    });
    const processedRefund = await callRefund(refund);
    const { rows: detailRows } = await orderModel.getOrderById(req.params.id);
    const updatedOrder = detailRows[0];
    notifyOrder(updatedOrder, 'refunded', req.body.note || 'Razorpay refund initiated');

    res.status(201).json({ success: true, message: 'Razorpay refund initiated', refund: processedRefund, order: updatedOrder });
  } catch (err) {
    next(err);
  }
};

module.exports = { createOrder, getUserOrders, getOrderDetails, getAllOrders, updateOrderStatus, cancelUserOrder, refundOrder };
