const express = require('express');
const { query } = require('express-validator');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { checkServiceability } = require('../controllers/shippingController');

const router = express.Router();

router.get(
  '/serviceability',
  protect,
  [query('postalCode').matches(/^\d{6}$/).withMessage('Postal code must contain exactly 6 digits')],
  validate,
  checkServiceability
);

module.exports = router;
