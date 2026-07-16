const express = require('express');
const { body } = require('express-validator');
const { submitContact } = require('../controllers/contactController');
const validate = require('../middleware/validate');

const router = express.Router();

router.post(
  '/',
  [
    body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('topic').trim().isLength({ min: 2, max: 80 }).withMessage('Topic is required'),
    body('message').trim().isLength({ min: 10, max: 2000 }).withMessage('Message must be 10-2000 characters'),
  ],
  validate,
  submitContact
);

module.exports = router;
