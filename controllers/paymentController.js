const crypto = require('crypto');
const Razorpay = require('razorpay');
const cartModel = require('../models/cartModel');
const orderModel = require('../models/orderModel');
const paymentModel = require('../models/paymentModel');
const couponModel = require('../models/couponModel');

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

const applyCoupon = async (code, subtotal) => {
  if (!code) {
    return { coupon: null, discount: 0, total: subtotal };
  }

  const { rows } = await couponModel.findActiveByCode(code);
  if (!rows.length) {
    const error = new Error('Coupon is invalid or expired');
    error.statusCode = 400;
    throw error;
  }

  const coupon = rows[0];
  const discount = couponModel.calculateDiscount(coupon, subtotal);
  if (discount <= 0) {
    const error = new Error(`Minimum order amount is ${Number(coupon.min_order_amount).toFixed(2)}`);
    error.statusCode = 400;
    throw error;
  }

  return {
    coupon,
    discount,
    total: Number((subtotal - discount).toFixed(2)),
  };
};

// POST /api/payments/razorpay/order
const createRazorpayOrder = async (req, res, next) => {
  try {
    const { shipping_address, coupon_code } = req.body;
    if (!shipping_address || !shipping_address.address || !shipping_address.city || !shipping_address.postalCode) {
      return res.status(400).json({ success: false, message: 'Complete shipping address is required' });
    }

    const { total: subtotal } = await getCartTotal(req.user.id);
    const discountResult = await applyCoupon(coupon_code, subtotal);
    const total = discountResult.total;
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
      subtotalAmount: subtotal,
      discountAmount: discountResult.discount,
      couponCode: discountResult.coupon?.code,
      currency,
      shippingAddress: shipping_address,
    });

    res.status(201).json({
      success: true,
      order: {
        id: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        subtotal,
        discount: discountResult.discount,
        total,
        coupon_code: discountResult.coupon?.code || null,
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

    const { cartItems, total: currentSubtotal } = await getCartTotal(req.user.id);
    if (Number(attempt.subtotal_amount || attempt.amount) !== currentSubtotal) {
      await paymentModel.markFailed({ id: attempt.id, razorpayPaymentId: razorpay_payment_id });
      return res.status(409).json({ success: false, message: 'Cart total changed. Please restart checkout.' });
    }
    const items = cartItems.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      price: parseFloat(item.price),
    }));

    const order = await orderModel.createOrder(req.user.id, Number(attempt.amount).toFixed(2), items, {
      shipping_address: attempt.shipping_address,
      payment_status: 'paid',
      payment_provider: 'razorpay',
      payment_reference: razorpay_payment_id,
      razorpay_order_id,
      razorpay_payment_id,
      subtotal_price: Number(attempt.subtotal_amount || attempt.amount).toFixed(2),
      discount_amount: Number(attempt.discount_amount || 0).toFixed(2),
      coupon_code: attempt.coupon_code,
    });

    await paymentModel.markPaid({ id: attempt.id, razorpayPaymentId: razorpay_payment_id, createdOrderId: order.id });
    if (attempt.coupon_code) {
      await couponModel.incrementUsage(attempt.coupon_code);
    }
    await cartModel.clearCart(req.user.id);

    res.status(201).json({ success: true, message: 'Payment verified and order placed', order });
  } catch (err) {
    next(err);
  }
};

module.exports = { createRazorpayOrder, verifyRazorpayPayment };
