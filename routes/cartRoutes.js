const express = require('express');
const { body, param } = require('express-validator');
const { getCart, addToCart, updateCartItem, removeCartItem } = require('../controllers/cartController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect); // all cart routes require auth

router.get('/', getCart);

router.post(
  '/',
  [
    body('product_id').isUUID().withMessage('Valid product_id is required'),
    body('quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  ],
  validate,
  addToCart
);

router.put(
  '/:id',
  [
    param('id').isUUID().withMessage('Cart item ID must be a valid UUID'),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  ],
  validate,
  updateCartItem
);

router.delete(
  '/:id',
  [param('id').isUUID().withMessage('Cart item ID must be a valid UUID')],
  validate,
  removeCartItem
);

module.exports = router;
