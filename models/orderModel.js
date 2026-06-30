const db = require('../config/db');

const createOrder = async (userId, totalPrice, items) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      `INSERT INTO orders (user_id, total_price) VALUES ($1, $2) RETURNING *`,
      [userId, totalPrice]
    );
    const order = orderResult.rows[0];

    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)`,
        [order.id, item.product_id, item.quantity, item.price]
      );
      // Decrement stock
      await client.query(
        `UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2`,
        [item.quantity, item.product_id]
      );
    }

    await client.query('COMMIT');
    return order;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const getOrdersByUser = (userId) =>
  db.query(
    `SELECT o.*, json_agg(
        json_build_object(
          'id', oi.id,
          'product_id', oi.product_id,
          'quantity', oi.quantity,
          'price', oi.price,
          'product_name', p.name,
          'image_url', p.image_url
        )
      ) AS items
     FROM orders o
     JOIN order_items oi ON o.id = oi.order_id
     JOIN products p ON oi.product_id = p.id
     WHERE o.user_id = $1
     GROUP BY o.id
     ORDER BY o.created_at DESC`,
    [userId]
  );

const getAllOrders = ({ limit, offset, status }) => {
  const conditions = status ? `WHERE o.status = '${status}'` : '';
  return db.query(
    `SELECT o.*, u.name AS user_name, u.email AS user_email,
            COUNT(*) OVER() AS total_count
     FROM orders o
     JOIN users u ON o.user_id = u.id
     ${conditions}
     ORDER BY o.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
};

const getOrderById = (orderId) =>
  db.query(
    `SELECT o.*, json_agg(
        json_build_object(
          'id', oi.id,
          'product_id', oi.product_id,
          'quantity', oi.quantity,
          'price', oi.price,
          'product_name', p.name,
          'image_url', p.image_url
        )
      ) AS items
     FROM orders o
     JOIN order_items oi ON o.id = oi.order_id
     JOIN products p ON oi.product_id = p.id
     WHERE o.id = $1
     GROUP BY o.id`,
    [orderId]
  );

const updateStatus = (orderId, status) =>
  db.query(
    `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, orderId]
  );

const sumRevenue = () =>
  db.query(`SELECT COALESCE(SUM(total_price), 0) AS revenue FROM orders WHERE status != 'cancelled'`);

const countOrders = () =>
  db.query('SELECT COUNT(*) FROM orders');

module.exports = { createOrder, getOrdersByUser, getAllOrders, getOrderById, updateStatus, sumRevenue, countOrders };
