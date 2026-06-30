const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userModel = require('../models/userModel');

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    const existing = await userModel.findByEmail(email);
    if (existing.rows.length) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
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

module.exports = { register, login, getMe };
