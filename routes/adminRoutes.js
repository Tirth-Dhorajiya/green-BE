const express = require('express');
const { body, param } = require('express-validator');
const { getDashboardStats, getCustomers, getCustomerDetails } = require('../controllers/adminController');
const { getAllOrders, updateOrderStatus } = require('../controllers/orderController');
const { getAdminReviews, updateReviewStatus } = require('../controllers/reviewController');
const { getAdminCoupons, createAdminCoupon, updateAdminCoupon } = require('../controllers/couponController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect, adminOnly); // all admin routes guarded

router.get('/stats', getDashboardStats);
router.get('/orders', getAllOrders);
router.get('/customers', getCustomers);
router.get('/customers/:id', [param('id').isUUID().withMessage('Customer ID must be a valid UUID')], validate, getCustomerDetails);
router.get('/reviews', getAdminReviews);
router.get('/coupons', getAdminCoupons);
router.post(
  '/coupons',
  [
    body('code').trim().notEmpty().withMessage('Coupon code is required'),
    body('discount_type').isIn(['percent', 'fixed']).withMessage('Discount type must be percent or fixed'),
    body('discount_value').isFloat({ min: 0.01 }).withMessage('Discount value must be greater than 0'),
    body('min_order_amount').optional().isFloat({ min: 0 }).withMessage('Minimum order must be non-negative'),
    body('max_discount_amount').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Maximum discount must be non-negative'),
    body('usage_limit').optional({ nullable: true }).custom((value) => value === '' || value === null || Number(value) > 0).withMessage('Usage limit must be greater than 0'),
    body('is_active').optional().isBoolean().withMessage('Active status must be true or false'),
  ],
  validate,
  createAdminCoupon
);
router.put(
  '/coupons/:id',
  [
    param('id').isUUID().withMessage('Coupon ID must be a valid UUID'),
    body('code').optional().trim().notEmpty().withMessage('Coupon code cannot be empty'),
    body('discount_type').optional().isIn(['percent', 'fixed']).withMessage('Discount type must be percent or fixed'),
    body('discount_value').optional().isFloat({ min: 0.01 }).withMessage('Discount value must be greater than 0'),
    body('min_order_amount').optional().isFloat({ min: 0 }).withMessage('Minimum order must be non-negative'),
    body('max_discount_amount').optional({ nullable: true }).custom((value) => value === '' || value === null || Number(value) >= 0).withMessage('Maximum discount must be non-negative'),
    body('usage_limit').optional({ nullable: true }).custom((value) => value === '' || value === null || Number(value) > 0).withMessage('Usage limit must be greater than 0'),
    body('is_active').optional().isBoolean().withMessage('Active status must be true or false'),
  ],
  validate,
  updateAdminCoupon
);

router.put(
  '/orders/:id/status',
  [
    param('id').isUUID().withMessage('Order ID must be a valid UUID'),
    body('status')
      .isIn(['pending', 'processing', 'shipped', 'delivered', 'cancelled'])
      .withMessage('Invalid status value'),
  ],
  validate,
  updateOrderStatus
);

router.put(
  '/reviews/:id/status',
  [
    param('id').isUUID().withMessage('Review ID must be a valid UUID'),
    body('status').isIn(['visible', 'hidden']).withMessage('Invalid review status'),
  ],
  validate,
  updateReviewStatus
);

module.exports = router;


