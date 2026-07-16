const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'commerce_completion.sql'), 'utf8');
    await pool.query(sql);
    console.log('Commerce migration applied successfully');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
