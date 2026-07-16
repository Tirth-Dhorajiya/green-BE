const express = require('express');
const { body } = require('express-validator');
const { register, login, getMe, updateMe, sendAuthOtp, verifyAuthOtp, resetPassword } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');

const router = express.Router();

router.post(
  '/otp/send',
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('purpose').isIn(['register', 'password_reset']).withMessage('Invalid OTP purpose'),
  ],
  validate,
  sendAuthOtp
);

router.post(
  '/otp/verify',
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('purpose').isIn(['register', 'password_reset']).withMessage('Invalid OTP purpose'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  ],
  validate,
  verifyAuthOtp
);

router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
    body('emailVerificationToken').notEmpty().withMessage('Email verification is required'),
  ],
  validate,
  register
);

router.post(
  '/password/reset',
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('resetToken').notEmpty().withMessage('Reset token is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  validate,
  resetPassword
);

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  login
);

router.get('/me', protect, getMe);
router.put(
  '/me',
  protect,
  [
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('address').optional().isObject().withMessage('Address must be an object'),
  ],
  validate,
  updateMe
);

module.exports = router;
