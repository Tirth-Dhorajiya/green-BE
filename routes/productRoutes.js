const express = require('express');
const { body, param } = require('express-validator');
const {
  getAllProducts,
  getProduct,
  addProduct,
  updateProduct,
  deleteProduct,
} = require('../controllers/productController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { uploadCloud } = require('../config/cloudinary');

const router = express.Router();

router.get('/', getAllProducts);

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
    body('category').isIn(['plants', 'seeds', 'tools', 'other']).withMessage('Category must be plants, seeds, tools, or other'),
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
    body('category').optional().isIn(['plants', 'seeds', 'tools', 'other']).withMessage('Invalid category'),
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

module.exports = router;
