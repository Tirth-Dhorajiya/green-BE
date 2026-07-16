const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const db = require('./config/db');
const errorHandler = require('./middleware/errorHandler');

// Routes
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const cartRoutes = require('./routes/cartRoutes');
const orderRoutes = require('./routes/orderRoutes');
const adminRoutes = require('./routes/adminRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const couponRoutes = require('./routes/couponRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');
const contactRoutes = require('./routes/contactRoutes');

const app = express();

// ─── Security & Rate Limiting ─────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many login attempts, please try again in 15 minutes.' },
});

// ─── Core Middleware ──────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Static Uploads ───────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    const result = await db.query('SELECT NOW()');
    res.json({ success: true, status: 'UP', database: 'CONNECTED', time: result.rows[0].now });
  } catch {
    res.status(500).json({ success: true, status: 'UP', database: 'DISCONNECTED' });
  }
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', [limiter, authLimiter], authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/contact', [limiter], contactRoutes);
app.use('/api/admin', adminRoutes);

// ─── Root ─────────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: '🌿 Green Store API',
    version: '1.0.0',
    docs: '/health',
  });
});

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   API:    http://localhost:${PORT}/api\n`);
});
