const express = require('express');
const { body, param } = require('express-validator');
const { getDashboardStats, getCustomers, getCustomerDetails } = require('../controllers/adminController');
const { getAllOrders, updateOrderStatus, refundOrder } = require('../controllers/orderController');
const { getAdminReviews, updateReviewStatus } = require('../controllers/reviewController');
const { getAdminCoupons, createAdminCoupon, updateAdminCoupon } = require('../controllers/couponController');
const {
  createShipment,
  syncShipment,
  cancelShipment,
  getLabel,
  schedulePickup,
  listPickups,
  updatePickupStatus,
} = require('../controllers/shippingController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect, adminOnly); // all admin routes guarded

router.get('/stats', getDashboardStats);
router.get('/orders', getAllOrders);
router.get('/pickups', listPickups);
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

router.post(
  '/orders/:id/shipments',
  [
    param('id').isUUID().withMessage('Order ID must be a valid UUID'),
    body('packages').isArray({ min: 1, max: 20 }).withMessage('Provide between 1 and 20 packages'),
    body('packages.*.weight_grams').isFloat({ gt: 0 }).withMessage('Package weight must be greater than 0'),
    body('packages.*.length_cm').isFloat({ gt: 0 }).withMessage('Package length must be greater than 0'),
    body('packages.*.width_cm').isFloat({ gt: 0 }).withMessage('Package width must be greater than 0'),
    body('packages.*.height_cm').isFloat({ gt: 0 }).withMessage('Package height must be greater than 0'),
    body('packages.*.contents').trim().isLength({ min: 1, max: 500 }).withMessage('Package contents are required'),
    body('ewaybill_number').optional({ nullable: true, checkFalsy: true }).matches(/^\d{12}$/).withMessage('E-waybill number must contain 12 digits'),
  ],
  validate,
  createShipment
);

router.post(
  '/shipments/:shipmentId/sync',
  [param('shipmentId').isUUID().withMessage('Shipment ID must be a valid UUID')],
  validate,
  syncShipment
);

router.post(
  '/shipments/:shipmentId/cancel',
  [param('shipmentId').isUUID().withMessage('Shipment ID must be a valid UUID')],
  validate,
  cancelShipment
);

router.get(
  '/shipments/:shipmentId/packages/:packageId/label',
  [
    param('shipmentId').isUUID().withMessage('Shipment ID must be a valid UUID'),
    param('packageId').isUUID().withMessage('Package ID must be a valid UUID'),
  ],
  validate,
  getLabel
);

router.post(
  '/pickups',
  [
    body('pickup_date').isISO8601({ strict: true }).withMessage('Pickup date must be valid'),
    body('pickup_time').matches(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).withMessage('Pickup time must be HH:mm or HH:mm:ss'),
    body('expected_package_count').isInt({ min: 1, max: 10000 }).withMessage('Expected package count must be positive'),
  ],
  validate,
  schedulePickup
);

router.put(
  '/pickups/:pickupId/status',
  [
    param('pickupId').isUUID().withMessage('Pickup ID must be a valid UUID'),
    body('status').isIn(['completed', 'cancelled']).withMessage('Pickup status must be completed or cancelled'),
  ],
  validate,
  updatePickupStatus
);

router.put(
  '/orders/:id/status',
  [
    param('id').isUUID().withMessage('Order ID must be a valid UUID'),
    body('status')
      .isIn(['pending', 'processing', 'shipped', 'delivered', 'cancelled'])
      .withMessage('Invalid status value'),
    body('courier_name').optional({ nullable: true, checkFalsy: true }).trim(),
    body('tracking_number').optional({ nullable: true, checkFalsy: true }).trim(),
    body('estimated_delivery_date').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('Estimated delivery date must be valid'),
    body('admin_notes').optional({ nullable: true, checkFalsy: true }).trim(),
    body('note').optional({ nullable: true, checkFalsy: true }).trim(),
  ],
  validate,
  updateOrderStatus
);

router.put(
  '/orders/:id/refund',
  [
    param('id').isUUID().withMessage('Order ID must be a valid UUID'),
    body('note').optional({ nullable: true, checkFalsy: true }).trim(),
  ],
  validate,
  refundOrder
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


