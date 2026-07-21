const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  try {
    const migrations = [
      'commerce_completion.sql',
      'add_product_images.sql',
      'order_fulfillment_tracking.sql',
      'shipping_integration.sql',
      'returns_refunds.sql',
      'review_images.sql',
      'growing_plans.sql',
    ];

    for (const migration of migrations) {
      const sql = fs.readFileSync(path.join(__dirname, migration), 'utf8');
      await pool.query(sql);
      console.log(`${migration} applied successfully`);
    }
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
