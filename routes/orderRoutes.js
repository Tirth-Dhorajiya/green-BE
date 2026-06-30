const express = require('express');
const { body, param } = require('express-validator');
const {
  createOrder,
  getUserOrders,
  getAllOrders,
  updateOrderStatus,
} = require('../controllers/orderController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');

const router = express.Router();

// User routes
router.post('/', protect, createOrder);
router.get('/my', protect, getUserOrders);

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
  ],
  validate,
  updateOrderStatus
);

module.exports = router;
