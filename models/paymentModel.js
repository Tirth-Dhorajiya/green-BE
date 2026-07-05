const db = require('../config/db');

const createAttempt = ({ userId, razorpayOrderId, amount, currency, shippingAddress }) =>
  db.query(
    `INSERT INTO payment_attempts (user_id, razorpay_order_id, amount, currency, shipping_address)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, razorpayOrderId, amount, currency, JSON.stringify(shippingAddress || {})]
  );

const findByRazorpayOrderId = (razorpayOrderId, userId) =>
  db.query(
    `SELECT * FROM payment_attempts WHERE razorpay_order_id = $1 AND user_id = $2`,
    [razorpayOrderId, userId]
  );

const markPaid = ({ id, razorpayPaymentId, createdOrderId }) =>
  db.query(
    `UPDATE payment_attempts
     SET status = 'paid', razorpay_payment_id = $1, created_order_id = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [razorpayPaymentId, createdOrderId, id]
  );

const markFailed = ({ id, razorpayPaymentId }) =>
  db.query(
    `UPDATE payment_attempts
     SET status = 'failed', razorpay_payment_id = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [razorpayPaymentId || null, id]
  );

module.exports = { createAttempt, findByRazorpayOrderId, markPaid, markFailed };
