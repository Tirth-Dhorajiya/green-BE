const crypto = require('crypto');
const Razorpay = require('razorpay');
const cartModel = require('../models/cartModel');
const orderModel = require('../models/orderModel');
const paymentModel = require('../models/paymentModel');

const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay credentials are not configured');
  }

  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
};

const getCartTotal = async (userId) => {
  const { rows: cartItems } = await cartModel.getCartByUser(userId);
  if (!cartItems.length) {
    const error = new Error('Cart is empty');
    error.statusCode = 400;
    throw error;
  }

  for (const item of cartItems) {
    if (item.stock < item.quantity) {
      const error = new Error(`Insufficient stock for "${item.name}"`);
      error.statusCode = 400;
      throw error;
    }
  }

  const total = cartItems.reduce((sum, item) => sum + parseFloat(item.price) * item.quantity, 0);
  return { cartItems, total: parseFloat(total.toFixed(2)) };
};

// POST /api/payments/razorpay/order
const createRazorpayOrder = async (req, res, next) => {
  try {
    const { shipping_address } = req.body;
    if (!shipping_address || !shipping_address.address || !shipping_address.city || !shipping_address.postalCode) {
      return res.status(400).json({ success: false, message: 'Complete shipping address is required' });
    }

    const { total } = await getCartTotal(req.user.id);
    const currency = process.env.RAZORPAY_CURRENCY || 'INR';
    const razorpay = getRazorpay();
    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(total * 100),
      currency,
      receipt: `green_${Date.now()}`,
    });

    await paymentModel.createAttempt({
      userId: req.user.id,
      razorpayOrderId: razorpayOrder.id,
      amount: total,
      currency,
      shippingAddress: shipping_address,
    });

    res.status(201).json({
      success: true,
      order: {
        id: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
      },
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/payments/razorpay/verify
const verifyRazorpayPayment = async (req, res, next) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Payment verification details are required' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const { rows: attempts } = await paymentModel.findByRazorpayOrderId(razorpay_order_id, req.user.id);
    if (!attempts.length) {
      return res.status(404).json({ success: false, message: 'Payment attempt not found' });
    }

    const attempt = attempts[0];
    if (attempt.status === 'paid' && attempt.created_order_id) {
      const { rows } = await orderModel.getOrderById(attempt.created_order_id);
      return res.json({ success: true, message: 'Payment already verified', order: rows[0] });
    }

    if (expectedSignature !== razorpay_signature) {
      await paymentModel.markFailed({ id: attempt.id, razorpayPaymentId: razorpay_payment_id });
      return res.status(400).json({ success: false, message: 'Invalid payment signature' });
    }

    const { cartItems, total } = await getCartTotal(req.user.id);
    const items = cartItems.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      price: parseFloat(item.price),
    }));

    const order = await orderModel.createOrder(req.user.id, total.toFixed(2), items, {
      shipping_address: attempt.shipping_address,
      payment_status: 'paid',
      payment_provider: 'razorpay',
      payment_reference: razorpay_payment_id,
      razorpay_order_id,
      razorpay_payment_id,
    });

    await paymentModel.markPaid({ id: attempt.id, razorpayPaymentId: razorpay_payment_id, createdOrderId: order.id });
    await cartModel.clearCart(req.user.id);

    res.status(201).json({ success: true, message: 'Payment verified and order placed', order });
  } catch (err) {
    next(err);
  }
};

module.exports = { createRazorpayOrder, verifyRazorpayPayment };
