const express = require('express');
const { body, param } = require('express-validator');
const { getDashboardStats, getCustomers } = require('../controllers/adminController');
const { getAllOrders, updateOrderStatus } = require('../controllers/orderController');
const { getAdminReviews, updateReviewStatus } = require('../controllers/reviewController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect, adminOnly); // all admin routes guarded

router.get('/stats', getDashboardStats);
router.get('/orders', getAllOrders);
router.get('/customers', getCustomers);
router.get('/reviews', getAdminReviews);

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


