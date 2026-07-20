const express = require('express');
const { body, param } = require('express-validator');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { uploadCloud } = require('../config/cloudinary');
const { uploadEvidence, createReturn, listMyReturns, getReturn, cancelReturn } = require('../controllers/returnController');

const router = express.Router();
router.use(protect);

router.post('/evidence', (req, res, next) => process.env.RETURNS_ENABLED === 'true' ? next() : res.status(503).json({ success: false, message: 'Online returns are not enabled yet' }), uploadCloud.array('evidence', 5), uploadEvidence);
router.get('/', listMyReturns);
router.post(
  '/orders/:orderId',
  [
    param('orderId').isUUID().withMessage('Order ID must be a valid UUID'),
    body('preferred_resolution').isIn(['refund', 'replacement']).withMessage('Choose refund or replacement'),
    body('explanation').optional({ nullable: true }).trim().isLength({ max: 2000 }).withMessage('Explanation is too long'),
    body('items').isArray({ min: 1, max: 50 }).withMessage('Select at least one return item'),
    body('items.*.order_item_id').isUUID().withMessage('Return item is invalid'),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('Return quantity must be positive'),
    body('items.*.reason').isIn(['damaged', 'dead', 'defective', 'missing', 'wrong_item', 'not_as_described', 'change_of_mind']).withMessage('Return reason is invalid'),
    body('evidence').optional().isArray({ max: 5 }).withMessage('Upload no more than five evidence images'),
  ],
  validate,
  createReturn
);
router.get('/:returnId', [param('returnId').isUUID().withMessage('Return ID must be valid')], validate, getReturn);
router.post(
  '/:returnId/cancel',
  [param('returnId').isUUID().withMessage('Return ID must be valid'), body('note').optional().trim().isLength({ max: 500 })],
  validate,
  cancelReturn
);

module.exports = router;
