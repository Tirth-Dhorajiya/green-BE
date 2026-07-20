const db = require('../config/db');

const getProductReviews = (productId, { limit, offset }) =>
  db.query(
    `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS user_name,
            COALESCE(review_media.images, '[]'::json) AS images
     FROM reviews r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN LATERAL (
       SELECT json_agg(
         json_build_object(
           'id', ri.id,
           'url', ri.url,
           'sort_order', ri.sort_order
         ) ORDER BY ri.sort_order
       ) AS images
       FROM review_images ri
       WHERE ri.review_id = r.id AND ri.status = 'visible'
     ) review_media ON true
     WHERE r.product_id = $1 AND r.status = 'visible'
     ORDER BY r.created_at DESC
     LIMIT $2 OFFSET $3`,
    [productId, limit, offset]
  );

const getProductSummary = (productId) =>
  db.query(
    `SELECT COALESCE(AVG(rating), 0)::float AS average_rating, COUNT(*)::int AS review_count
     FROM reviews
     WHERE product_id = $1 AND status = 'visible'`,
    [productId]
  );

const createReview = async ({ productId, userId, orderId, rating, comment, images = [] }) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO reviews (product_id, user_id, order_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [productId, userId, orderId, rating, comment || null]
    );

    const storedImages = [];
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const result = await client.query(
        `INSERT INTO review_images (review_id, url, public_id, sort_order)
         VALUES ($1, $2, $3, $4)
         RETURNING id, url, public_id, sort_order, status, created_at`,
        [rows[0].id, image.url, image.public_id, index]
      );
      storedImages.push(result.rows[0]);
    }

    await client.query('COMMIT');
    return { rows: [{ ...rows[0], images: storedImages }] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

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
            COALESCE(review_media.images, '[]'::json) AS images,
            COUNT(*) OVER() AS total_count
     FROM reviews r
     JOIN products p ON p.id = r.product_id
     JOIN users u ON u.id = r.user_id
     LEFT JOIN LATERAL (
       SELECT json_agg(
         json_build_object(
           'id', ri.id,
           'url', ri.url,
           'sort_order', ri.sort_order,
           'status', ri.status,
           'created_at', ri.created_at
         ) ORDER BY ri.sort_order
       ) AS images
       FROM review_images ri
       WHERE ri.review_id = r.id
     ) review_media ON true
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

const getReviewImage = (reviewId, imageId) =>
  db.query(
    `SELECT ri.*
     FROM review_images ri
     WHERE ri.review_id = $1 AND ri.id = $2`,
    [reviewId, imageId]
  );

const updateReviewImageStatus = (reviewId, imageId, status) =>
  db.query(
    `UPDATE review_images
     SET status = $1, updated_at = NOW()
     WHERE review_id = $2 AND id = $3
     RETURNING id, review_id, url, public_id, sort_order, status, created_at, updated_at`,
    [status, reviewId, imageId]
  );

const deleteReviewImage = (reviewId, imageId) =>
  db.query(
    `DELETE FROM review_images
     WHERE review_id = $1 AND id = $2
     RETURNING id, review_id, url, public_id`,
    [reviewId, imageId]
  );

const getProductReviewImages = (productId) =>
  db.query(
    `SELECT ri.public_id
     FROM review_images ri
     JOIN reviews r ON r.id = ri.review_id
     WHERE r.product_id = $1`,
    [productId]
  );

module.exports = {
  getProductReviews,
  getProductSummary,
  createReview,
  getAllReviews,
  updateStatus,
  getReviewImage,
  updateReviewImageStatus,
  deleteReviewImage,
  getProductReviewImages,
};
