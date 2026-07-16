const express = require('express');
const { body } = require('express-validator');
const { validateCoupon } = require('../controllers/couponController');
const validate = require('../middleware/validate');

const router = express.Router();

router.post(
  '/validate',
  [
    body('code').trim().notEmpty().withMessage('Coupon code is required'),
    body('subtotal').isFloat({ min: 0 }).withMessage('Subtotal must be a valid amount'),
  ],
  validate,
  validateCoupon
);

module.exports = router;
