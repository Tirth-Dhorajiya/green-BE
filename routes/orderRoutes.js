const express = require('express');
const { body, param } = require('express-validator');
const {
  createOrder,
  getUserOrders,
  getOrderDetails,
  getAllOrders,
  updateOrderStatus,
  cancelUserOrder,
  refundOrder,
} = require('../controllers/orderController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');

const router = express.Router();

// User routes
router.post('/', protect, createOrder);
router.get('/my', protect, getUserOrders);
router.get(
  '/:id',
  protect,
  [param('id').isUUID().withMessage('Order ID must be a valid UUID')],
  validate,
  getOrderDetails
);
router.put(
  '/:id/cancel',
  protect,
  [param('id').isUUID().withMessage('Order ID must be a valid UUID')],
  validate,
  cancelUserOrder
);

// Admin routes
router.get('/', protect, adminOnly, getAllOrders);

router.put(
  '/:id/status',
  protect,
  adminOnly,
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
  '/:id/refund',
  protect,
  adminOnly,
  [
    param('id').isUUID().withMessage('Order ID must be a valid UUID'),
    body('note').optional({ nullable: true, checkFalsy: true }).trim(),
  ],
  validate,
  refundOrder
);

module.exports = router;
