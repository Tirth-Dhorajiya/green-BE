const db = require('../config/db');

const getProductReviews = (productId) =>
  db.query(
    `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS user_name
     FROM reviews r
     JOIN users u ON u.id = r.user_id
     WHERE r.product_id = $1 AND r.status = 'visible'
     ORDER BY r.created_at DESC`,
    [productId]
  );

const getProductSummary = (productId) =>
  db.query(
    `SELECT COALESCE(AVG(rating), 0)::float AS average_rating, COUNT(*)::int AS review_count
     FROM reviews
     WHERE product_id = $1 AND status = 'visible'`,
    [productId]
  );

const createReview = ({ productId, userId, orderId, rating, comment }) =>
  db.query(
    `INSERT INTO reviews (product_id, user_id, order_id, rating, comment)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [productId, userId, orderId, rating, comment || null]
  );

const getAllReviews = ({ limit, offset, status, search, rating, sortBy, order }) => {
  const values = [];
  const conditions = [];
  let idx = 1;
  if (status) {
    conditions.push(`r.status = $${idx++}`);
    values.push(status);
  }
  if (rating) {
    conditions.push(`r.rating = $${idx++}`);
    values.push(Number(rating));
  }
  if (search) {
    conditions.push(`(p.name ILIKE $${idx} OR u.name ILIKE $${idx} OR u.email ILIKE $${idx} OR r.comment ILIKE $${idx})`);
    values.push(`%${search}%`);
    idx++;
  }

  const allowedSort = {
    product: 'p.name',
    customer: 'u.name',
    rating: 'r.rating',
    status: 'r.status',
    created_at: 'r.created_at',
  };
  const sortCol = allowedSort[sortBy] || 'r.created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(limit, offset);

  return db.query(
    `SELECT r.*, p.name AS product_name, u.name AS user_name, u.email AS user_email,
            COUNT(*) OVER() AS total_count
     FROM reviews r
     JOIN products p ON p.id = r.product_id
     JOIN users u ON u.id = r.user_id
     ${where}
     ORDER BY ${sortCol} ${sortOrder}
     LIMIT $${idx++} OFFSET $${idx++}`,
    values
  );
};

const updateStatus = (id, status) =>
  db.query(
    `UPDATE reviews SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, id]
  );

module.exports = { getProductReviews, getProductSummary, createReview, getAllReviews, updateStatus };
