const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const userModel = require('../models/userModel');
const otpModel = require('../models/otpModel');
const { sendOtpEmail } = require('../services/emailService');

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const generatePurposeToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });

const verifyPurposeToken = (token, purpose) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.purpose !== purpose) {
    const error = new Error('Invalid verification token');
    error.statusCode = 400;
    throw error;
  }
  return decoded;
};

const createOtp = async (email, purpose) => {
  const otp = String(crypto.randomInt(100000, 999999));
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await otpModel.createOtp({ email, purpose, otpHash, expiresAt });
  return otp;
};

const verifyOtp = async ({ email, purpose, otp }) => {
  const { rows } = await otpModel.findLatest({ email, purpose });
  if (!rows.length) {
    const error = new Error('OTP not found or expired');
    error.statusCode = 400;
    throw error;
  }

  const record = rows[0];
  if (new Date(record.expires_at).getTime() < Date.now()) {
    const error = new Error('OTP expired');
    error.statusCode = 400;
    throw error;
  }

  const matches = await bcrypt.compare(otp, record.otp_hash);
  if (!matches) {
    const error = new Error('Invalid OTP');
    error.statusCode = 400;
    throw error;
  }

  await otpModel.consume(record.id);
};

const sendAuthOtp = async (req, res, next) => {
  try {
    const { email, purpose } = req.body;
    if (purpose === 'register') {
      const existing = await userModel.findByEmail(email);
      if (existing.rows.length) {
        return res.status(409).json({ success: false, message: 'Email already registered' });
      }
    }
    if (purpose === 'password_reset') {
      const existing = await userModel.findByEmail(email);
      if (!existing.rows.length) {
        return res.status(404).json({ success: false, message: 'Email is not registered' });
      }
    }

    const otpPurpose = purpose === 'password_reset' ? 'password_reset' : 'register';
    const otp = await createOtp(email, otpPurpose);
    const delivery = await sendOtpEmail({ to: email, otp, purpose: otpPurpose });
    res.json({
      success: true,
      message: 'OTP sent',
      ...(delivery.devOtp ? { devOtp: delivery.devOtp } : {}),
    });
  } catch (err) {
    next(err);
  }
};

const verifyAuthOtp = async (req, res, next) => {
  try {
    const { email, purpose, otp } = req.body;
    const tokenPurpose = purpose === 'password_reset' ? 'password_reset_verified' : 'register_email_verified';
    const otpPurpose = purpose === 'password_reset' ? 'password_reset' : 'register';

    await verifyOtp({ email, purpose: otpPurpose, otp });
    res.json({
      success: true,
      message: 'OTP verified',
      token: generatePurposeToken({ email, purpose: tokenPurpose }),
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { name, email, password, emailVerificationToken } = req.body;

    const existing = await userModel.findByEmail(email);
    if (existing.rows.length) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const decoded = verifyPurposeToken(emailVerificationToken, 'register_email_verified');
    if (decoded.email !== email) {
      return res.status(400).json({ success: false, message: 'Email verification does not match this email' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const { rows } = await userModel.createUser(name, email, hashedPassword);
    const user = rows[0];

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      token: generateToken(user.id),
      user,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const { rows } = await userModel.findByEmail(email);
    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const { password: _pwd, ...safeUser } = user;

    res.json({
      success: true,
      message: 'Login successful',
      token: generateToken(user.id),
      user: safeUser,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/me
const getMe = async (req, res, next) => {
  try {
    const { rows } = await userModel.findById(req.user.id);
    res.json({ success: true, user: rows[0] });
  } catch (err) {
    next(err);
  }
};

const updateMe = async (req, res, next) => {
  try {
    const { name, address } = req.body;
    const { rows } = await userModel.updateProfile(req.user.id, { name, address });
    res.json({ success: true, user: rows[0] });
  } catch (err) {
    next(err);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { email, password, resetToken } = req.body;
    const decoded = verifyPurposeToken(resetToken, 'password_reset_verified');
    if (decoded.email !== email) {
      return res.status(400).json({ success: false, message: 'Reset token does not match email' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const { rows } = await userModel.updatePassword(email, hashedPassword);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Email is not registered' });
    }

    res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, getMe, updateMe, sendAuthOtp, verifyAuthOtp, resetPassword };
