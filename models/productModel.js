const db = require('../config/db');

const getAllProducts = ({ category, minPrice, maxPrice, search, featured, stockStatus, limit, offset, sortBy, order }) => {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (category) {
    conditions.push(`category = $${idx++}`);
    values.push(category);
  }
  if (minPrice !== undefined) {
    conditions.push(`price >= $${idx++}`);
    values.push(minPrice);
  }
  if (maxPrice !== undefined) {
    conditions.push(`price <= $${idx++}`);
    values.push(maxPrice);
  }
  if (search) {
    conditions.push(`(name ILIKE $${idx} OR description ILIKE $${idx})`);
    values.push(`%${search}%`);
    idx++;
  }
  if (featured === true || featured === 'true') {
    conditions.push(`is_featured = true`);
  }
  if (featured === false || featured === 'false') {
    conditions.push(`is_featured = false`);
  }
  if (stockStatus === 'in_stock') {
    conditions.push('stock > 0');
  }
  if (stockStatus === 'low_stock') {
    conditions.push('stock > 0 AND stock <= 5');
  }
  if (stockStatus === 'out_of_stock') {
    conditions.push('stock = 0');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const allowedSort = ['price', 'name', 'created_at', 'stock', 'is_featured', 'category'];
  const sortCol = allowedSort.includes(sortBy) ? sortBy : 'created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  const sql = `
    SELECT *, COUNT(*) OVER() AS total_count
    FROM products
    ${where}
    ORDER BY ${sortCol} ${sortOrder}
    LIMIT $${idx++} OFFSET $${idx++}
  `;
  values.push(limit, offset);

  return db.query(sql, values);
};

const getById = (id) =>
  db.query('SELECT * FROM products WHERE id = $1', [id]);

const createProduct = ({ name, description, price, category, stock, image_url, thumbnail_url, images, is_featured, return_policy, return_window_hours, final_sale }) =>
  db.query(
    `INSERT INTO products (name, description, price, category, stock, image_url, thumbnail_url, images, is_featured, return_policy, return_window_hours, final_sale)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [name, description, price, category, stock, image_url, thumbnail_url, JSON.stringify(images || []), is_featured === true || is_featured === 'true', return_policy, return_window_hours, final_sale === true || final_sale === 'true']
  );

const updateProduct = (id, fields) => {
  const keys = Object.keys(fields);
  const values = keys.map(k => k === 'images' ? JSON.stringify(fields[k]) : fields[k]);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  values.push(id);
  return db.query(
    `UPDATE products SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
    values
  );
};

const deleteProduct = (id) =>
  db.query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);

const setFeatured = (id, isFeatured) =>
  db.query(
    'UPDATE products SET is_featured = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [isFeatured, id]
  );

const countProducts = () =>
  db.query('SELECT COUNT(*) FROM products');

module.exports = { getAllProducts, getById, createProduct, updateProduct, deleteProduct, setFeatured, countProducts };
