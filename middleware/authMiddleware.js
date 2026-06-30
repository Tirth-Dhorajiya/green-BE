const jwt = require('jsonwebtoken');
const db = require('../config/db');

/**
 * Protect route — verifies JWT and attaches user to req.
 */
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authorised — no token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { rows } = await db.query(
      'SELECT id, name, email, role FROM users WHERE id = $1',
      [decoded.id]
    );

    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    req.user = rows[0];
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Admin-only guard — must be used AFTER protect.
 */
const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  res.status(403).json({ success: false, message: 'Access denied — admin only' });
};

module.exports = { protect, adminOnly };
