const db = require('../config/db');

const FEATURED_PRODUCT_LIMIT = 10;
const FEATURED_LOCK_ID = 731204;

const featuredLimitError = () => {
  const error = new Error(`You can feature up to ${FEATURED_PRODUCT_LIMIT} products. Remove one featured product before adding another.`);
  error.statusCode = 409;
  error.code = 'FEATURED_PRODUCT_LIMIT';
  return error;
};

const inFeaturedTransaction = async (work) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [FEATURED_LOCK_ID]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const ensureFeaturedCapacity = async (client, excludeId = null) => {
  const { rows } = excludeId
    ? await client.query('SELECT COUNT(*) FROM products WHERE is_featured = true AND id <> $1', [excludeId])
    : await client.query('SELECT COUNT(*) FROM products WHERE is_featured = true');
  if (Number(rows[0].count) >= FEATURED_PRODUCT_LIMIT) throw featuredLimitError();
};

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

const createProduct = async ({ name, description, price, category, stock, image_url, thumbnail_url, images, is_featured, return_policy, return_window_hours, final_sale }) => {
  const values = [name, description, price, category, stock, image_url, thumbnail_url, JSON.stringify(images || []), is_featured === true || is_featured === 'true', return_policy, return_window_hours, final_sale === true || final_sale === 'true'];
  if (!values[8]) {
    return db.query(
      `INSERT INTO products (name, description, price, category, stock, image_url, thumbnail_url, images, is_featured, return_policy, return_window_hours, final_sale)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      values
    );
  }

  return inFeaturedTransaction(async (client) => {
    await ensureFeaturedCapacity(client);
    return client.query(
    `INSERT INTO products (name, description, price, category, stock, image_url, thumbnail_url, images, is_featured, return_policy, return_window_hours, final_sale)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
      values
    );
  });
};

const updateProduct = async (id, fields) => {
  const keys = Object.keys(fields);
  const values = keys.map(k => k === 'images' ? JSON.stringify(fields[k]) : fields[k]);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  values.push(id);
  const query = (client) => client.query(
      `UPDATE products SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );

  if (fields.is_featured !== true) return query(db);
  return inFeaturedTransaction(async (client) => {
    await ensureFeaturedCapacity(client, id);
    return query(client);
  });
};

const deleteProduct = (id) =>
  db.query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);

const setFeatured = (id, isFeatured) => {
  if (!isFeatured) {
    return db.query(
      'UPDATE products SET is_featured = false, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id]
    );
  }

  return inFeaturedTransaction(async (client) => {
    const existing = await client.query('SELECT id FROM products WHERE id = $1', [id]);
    if (!existing.rows.length) return existing;
    await ensureFeaturedCapacity(client, id);
    return client.query(
      'UPDATE products SET is_featured = true, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id]
    );
  });
};

const countProducts = () =>
  db.query('SELECT COUNT(*) FROM products');

const getGrowingCandidates = () => db.query(
  `SELECT id, name, description, price, category, stock, image_url, thumbnail_url,
          is_featured, created_at
   FROM products
   WHERE category IN ('plants', 'seeds', 'tools', 'planters', 'other')
   ORDER BY (stock > 0) DESC, is_featured DESC, created_at DESC
   LIMIT 1000`
);

module.exports = { FEATURED_PRODUCT_LIMIT, getAllProducts, getById, createProduct, updateProduct, deleteProduct, setFeatured, countProducts, getGrowingCandidates };
