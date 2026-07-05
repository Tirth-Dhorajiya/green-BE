const orderModel = require('../models/orderModel');
const productModel = require('../models/productModel');
const reviewModel = require('../models/reviewModel');

// GET /api/products/:id/reviews
const getProductReviews = async (req, res, next) => {
  try {
    const [reviewsResult, summaryResult] = await Promise.all([
      reviewModel.getProductReviews(req.params.id),
      reviewModel.getProductSummary(req.params.id),
    ]);

    res.json({
      success: true,
      reviews: reviewsResult.rows,
      summary: summaryResult.rows[0],
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/products/:id/reviews
const createProductReview = async (req, res, next) => {
  try {
    const { rows: productRows } = await productModel.getById(req.params.id);
    if (!productRows.length) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const { rows: deliveredOrders } = await orderModel.hasDeliveredProduct(req.user.id, req.params.id);
    if (!deliveredOrders.length) {
      return res.status(403).json({
        success: false,
        message: 'Only customers with a paid delivered order can review this product',
      });
    }

    const { rating, comment } = req.body;
    const { rows } = await reviewModel.createReview({
      productId: req.params.id,
      userId: req.user.id,
      orderId: deliveredOrders[0].order_id,
      rating,
      comment,
    });

    res.status(201).json({ success: true, message: 'Review submitted', review: rows[0] });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/reviews
const getAdminReviews = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    const { rows } = await reviewModel.getAllReviews({ limit: limitNum, offset, status });
    const totalCount = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;
    const reviews = rows.map(({ total_count, ...review }) => review);

    res.json({
      success: true,
      page: pageNum,
      limit: limitNum,
      totalCount,
      totalPages: Math.ceil(totalCount / limitNum),
      reviews,
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/admin/reviews/:id/status
const updateReviewStatus = async (req, res, next) => {
  try {
    const { rows } = await reviewModel.updateStatus(req.params.id, req.body.status);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    res.json({ success: true, message: 'Review status updated', review: rows[0] });
  } catch (err) {
    next(err);
  }
};

module.exports = { getProductReviews, createProductReview, getAdminReviews, updateReviewStatus };
