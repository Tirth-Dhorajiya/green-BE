const express = require('express');
const { body, param } = require('express-validator');
const { getWishlist, addToWishlist, removeFromWishlist } = require('../controllers/wishlistController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);

router.get('/', getWishlist);
router.post(
  '/',
  [body('product_id').isUUID().withMessage('Product ID must be a valid UUID')],
  validate,
  addToWishlist
);
router.delete(
  '/:productId',
  [param('productId').isUUID().withMessage('Product ID must be a valid UUID')],
  validate,
  removeFromWishlist
);

module.exports = router;
