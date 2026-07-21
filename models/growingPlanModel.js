const db = require('../config/db');

const MAX_SAVED_PLANS = 20;

const create = async ({ userId, name, filters, cropSlugs, datasetVersion }) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`growing-plans:${userId}`]);
    const countResult = await client.query('SELECT COUNT(*) FROM saved_growing_plans WHERE user_id = $1', [userId]);
    if (Number(countResult.rows[0].count) >= MAX_SAVED_PLANS) {
      const error = new Error(`You can save up to ${MAX_SAVED_PLANS} growing plans. Delete one before saving another.`);
      error.statusCode = 409;
      throw error;
    }
    const result = await client.query(
      `INSERT INTO saved_growing_plans (user_id, name, filters, crop_slugs, dataset_version)
       VALUES ($1, $2, $3::jsonb, $4::text[], $5)
       RETURNING *`,
      [userId, name, JSON.stringify(filters), cropSlugs, datasetVersion]
    );
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const listByUser = (userId) => db.query(
  'SELECT * FROM saved_growing_plans WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
  [userId]
);

const deleteByUser = (id, userId) => db.query(
  'DELETE FROM saved_growing_plans WHERE id = $1 AND user_id = $2 RETURNING id',
  [id, userId]
);

module.exports = { MAX_SAVED_PLANS, create, listByUser, deleteByUser };
