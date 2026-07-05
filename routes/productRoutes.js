const express = require('express');
const { body, param } = require('express-validator');
const {
  getAllProducts,
  getProduct,
  addProduct,
  updateProduct,
  deleteProduct,
  setFeaturedProduct,
} = require('../controllers/productController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { uploadCloud } = require('../config/cloudinary');
const { getProductReviews, createProductReview } = require('../controllers/reviewController');

const router = express.Router();

router.get('/', getAllProducts);

router.get(
  '/:id/reviews',
  [param('id').isUUID().withMessage('Product ID must be a valid UUID')],
  validate,
  getProductReviews
);

router.post(
  '/:id/reviews',
  protect,
  [
    param('id').isUUID().withMessage('Product ID must be a valid UUID'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
    body('comment').optional().trim().isLength({ max: 1000 }).withMessage('Comment must be 1000 characters or less'),
  ],
  validate,
  createProductReview
);

router.get(
  '/:id',
  [param('id').isUUID().withMessage('Product ID must be a valid UUID')],
  validate,
  getProduct
);

router.post(
  '/',
  protect,
  adminOnly,
  uploadCloud.array('images', 10),
  [
    body('name').trim().notEmpty().withMessage('Product name is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),
    body('category').isIn(['plants', 'seeds', 'tools', 'planters', 'other']).withMessage('Category must be plants, seeds, tools, planters, or other'),
    body('stock').optional().isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),
  ],
  validate,
  addProduct
);

router.put(
  '/:id',
  protect,
  adminOnly,
  uploadCloud.array('images', 10),
  [
    param('id').isUUID().withMessage('Product ID must be a valid UUID'),
    body('price').optional().isFloat({ min: 0 }).withMessage('Price must be a non-negative number'),
    body('category').optional().isIn(['plants', 'seeds', 'tools', 'planters', 'other']).withMessage('Invalid category'),
    body('stock').optional().isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),
  ],
  validate,
  updateProduct
);

router.delete(
  '/:id',
  protect,
  adminOnly,
  [param('id').isUUID().withMessage('Product ID must be a valid UUID')],
  validate,
  deleteProduct
);

router.put(
  '/:id/featured',
  protect,
  adminOnly,
  [
    param('id').isUUID().withMessage('Product ID must be a valid UUID'),
    body('is_featured').isBoolean().withMessage('is_featured must be a boolean'),
  ],
  validate,
  setFeaturedProduct
);

module.exports = router;
