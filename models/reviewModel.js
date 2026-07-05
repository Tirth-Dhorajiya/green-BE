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

const getAllReviews = ({ limit, offset, status }) => {
  const values = [];
  let where = '';
  if (status) {
    values.push(status);
    where = `WHERE r.status = $${values.length}`;
  }
  values.push(limit, offset);

  return db.query(
    `SELECT r.*, p.name AS product_name, u.name AS user_name, u.email AS user_email,
            COUNT(*) OVER() AS total_count
     FROM reviews r
     JOIN products p ON p.id = r.product_id
     JOIN users u ON u.id = r.user_id
     ${where}
     ORDER BY r.created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
};

const updateStatus = (id, status) =>
  db.query(
    `UPDATE reviews SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, id]
  );

module.exports = { getProductReviews, getProductSummary, createReview, getAllReviews, updateStatus };
