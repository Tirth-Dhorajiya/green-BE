const db = require('../config/db');

const getCartByUser = (userId) =>
  db.query(
    `SELECT c.id, c.quantity, c.added_at,
            p.id AS product_id, p.name, p.price, COALESCE(p.thumbnail_url, p.image_url) AS image_url, p.stock
     FROM cart c
     JOIN products p ON c.product_id = p.id
     WHERE c.user_id = $1
     ORDER BY c.added_at DESC`,
    [userId]
  );

const getCartItem = (userId, productId) =>
  db.query('SELECT * FROM cart WHERE user_id = $1 AND product_id = $2', [userId, productId]);

const getCartItemById = (cartId, userId) =>
  db.query('SELECT * FROM cart WHERE id = $1 AND user_id = $2', [cartId, userId]);

const addItem = (userId, productId, quantity) =>
  db.query(
    `INSERT INTO cart (user_id, product_id, quantity)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = cart.quantity + $3
     RETURNING *`,
    [userId, productId, quantity]
  );

const updateItem = (cartId, userId, quantity) =>
  db.query(
    'UPDATE cart SET quantity = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
    [quantity, cartId, userId]
  );

const removeItem = (cartId, userId) =>
  db.query('DELETE FROM cart WHERE id = $1 AND user_id = $2 RETURNING id', [cartId, userId]);

const clearCart = (userId) =>
  db.query('DELETE FROM cart WHERE user_id = $1', [userId]);

module.exports = { getCartByUser, getCartItem, getCartItemById, addItem, updateItem, removeItem, clearCart };
