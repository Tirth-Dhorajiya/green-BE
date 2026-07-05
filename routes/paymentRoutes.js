const express = require('express');
const { body } = require('express-validator');
const { createRazorpayOrder, verifyRazorpayPayment } = require('../controllers/paymentController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);

router.post(
  '/razorpay/order',
  [
    body('shipping_address').isObject().withMessage('shipping_address is required'),
    body('shipping_address.address').trim().notEmpty().withMessage('Shipping address is required'),
    body('shipping_address.city').trim().notEmpty().withMessage('City is required'),
    body('shipping_address.postalCode').trim().notEmpty().withMessage('Postal code is required'),
  ],
  validate,
  createRazorpayOrder
);

router.post(
  '/razorpay/verify',
  [
    body('razorpay_order_id').trim().notEmpty().withMessage('Razorpay order ID is required'),
    body('razorpay_payment_id').trim().notEmpty().withMessage('Razorpay payment ID is required'),
    body('razorpay_signature').trim().notEmpty().withMessage('Razorpay signature is required'),
  ],
  validate,
  verifyRazorpayPayment
);

module.exports = router;
