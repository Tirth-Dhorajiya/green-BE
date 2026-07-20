const orderModel = require('../models/orderModel');
const productModel = require('../models/productModel');
const reviewModel = require('../models/reviewModel');
const { cloudinary } = require('../config/cloudinary');

const removeUploadedFiles = async (files = []) => {
  await Promise.all(files.map((file) => {
    const publicId = file.public_id || file.filename;
    return publicId ? cloudinary.uploader.destroy(publicId).catch(() => null) : null;
  }));
};

// GET /api/products/:id/reviews
const getProductReviews = async (req, res, next) => {
  try {
    const requestedPage = parseInt(req.query.page || '1', 10);
    const requestedLimit = parseInt(req.query.limit || '10', 10);
    const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1;
    const limit = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 10;
    const offset = (page - 1) * limit;
    const [reviewsResult, summaryResult] = await Promise.all([
      reviewModel.getProductReviews(req.params.id, { limit, offset }),
      reviewModel.getProductSummary(req.params.id),
    ]);
    const reviewCount = Number(summaryResult.rows[0]?.review_count || 0);

    res.json({
      success: true,
      reviews: reviewsResult.rows,
      summary: summaryResult.rows[0],
      page,
      limit,
      totalCount: reviewCount,
      totalPages: Math.max(1, Math.ceil(reviewCount / limit)),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/products/:id/reviews/eligibility
const getReviewEligibility = async (req, res, next) => {
  try {
    const { rows: productRows } = await productModel.getById(req.params.id);
    if (!productRows.length) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const { rows } = await orderModel.hasDeliveredProduct(req.user.id, req.params.id);
    res.json({ success: true, can_review: rows.length > 0 });
  } catch (err) {
    next(err);
  }
};

const requireReviewEligibility = async (req, res, next) => {
  try {
    const { rows: productRows } = await productModel.getById(req.params.id);
    if (!productRows.length) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const { rows } = await orderModel.hasDeliveredProduct(req.user.id, req.params.id);
    if (!rows.length) {
      return res.status(403).json({
        success: false,
        message: 'Only customers with a paid delivered order can review this product',
      });
    }

    req.reviewOrderId = rows[0].order_id;
    next();
  } catch (err) {
    next(err);
  }
};

// POST /api/products/:id/reviews
const createProductReview = async (req, res, next) => {
  const uploadedFiles = req.files || [];
  let reviewCreated = false;
  try {
    const rating = Number(req.body.rating);
    const comment = String(req.body.comment || '').trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      await removeUploadedFiles(uploadedFiles);
      return res.status(422).json({ success: false, message: 'Rating must be between 1 and 5' });
    }
    if (comment.length > 1000) {
      await removeUploadedFiles(uploadedFiles);
      return res.status(422).json({ success: false, message: 'Comment must be 1000 characters or less' });
    }

    const { rows } = await reviewModel.createReview({
      productId: req.params.id,
      userId: req.user.id,
      orderId: req.reviewOrderId,
      rating,
      comment,
      images: uploadedFiles.map((file) => ({
        url: file.path,
        public_id: file.public_id || file.filename,
      })),
    });
    reviewCreated = true;

    const review = {
      ...rows[0],
      images: (rows[0].images || []).map(({ public_id: _publicId, ...image }) => image),
    };
    res.status(201).json({ success: true, message: 'Review submitted', review });
  } catch (err) {
    if (!reviewCreated) await removeUploadedFiles(uploadedFiles);
    next(err);
  }
};

// GET /api/admin/reviews
const getAdminReviews = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      search,
      rating,
      sortBy = 'created_at',
      order = 'desc',
    } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    const { rows } = await reviewModel.getAllReviews({ limit: limitNum, offset, status, search, rating, sortBy, order });
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

const updateReviewImageStatus = async (req, res, next) => {
  try {
    const { rows } = await reviewModel.updateReviewImageStatus(
      req.params.reviewId,
      req.params.imageId,
      req.body.status
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Review photo not found' });
    }
    const { public_id: _publicId, ...image } = rows[0];
    res.json({ success: true, message: 'Review photo updated', image });
  } catch (err) {
    next(err);
  }
};

const deleteReviewImage = async (req, res, next) => {
  try {
    const { rows: existing } = await reviewModel.getReviewImage(req.params.reviewId, req.params.imageId);
    if (!existing.length) {
      return res.status(404).json({ success: false, message: 'Review photo not found' });
    }

    await cloudinary.uploader.destroy(existing[0].public_id);
    await reviewModel.deleteReviewImage(req.params.reviewId, req.params.imageId);
    res.json({ success: true, message: 'Review photo permanently removed' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProductReviews,
  getReviewEligibility,
  requireReviewEligibility,
  createProductReview,
  getAdminReviews,
  updateReviewStatus,
  updateReviewImageStatus,
  deleteReviewImage,
};
