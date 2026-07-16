const db = require('../config/db');

const getByUser = (userId) =>
  db.query(
    `SELECT p.id, w.id AS wishlist_id, w.product_id, w.created_at,
            p.name, p.description, p.price, p.category, p.stock,
            p.image_url, p.thumbnail_url, p.images
     FROM wishlist w
     JOIN products p ON p.id = w.product_id
     WHERE w.user_id = $1
     ORDER BY w.created_at DESC`,
    [userId]
  );

const add = (userId, productId) =>
  db.query(
    `INSERT INTO wishlist (user_id, product_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, product_id) DO NOTHING
     RETURNING *`,
    [userId, productId]
  );

const remove = (userId, productId) =>
  db.query('DELETE FROM wishlist WHERE user_id = $1 AND product_id = $2', [userId, productId]);

module.exports = { getByUser, add, remove };
