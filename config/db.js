const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('connect', () => {
  console.log('✅ PostgreSQL connected');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected PostgreSQL error:', err);
});

/**
 * Run a parameterised query against the pool.
 * @param {string} text  - SQL statement
 * @param {Array}  params - Bound parameters
 */
const query = (text, params) => pool.query(text, params);

module.exports = { query, pool };
