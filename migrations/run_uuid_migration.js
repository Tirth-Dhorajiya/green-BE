const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🚀 Starting UUID Migration...');
    await client.query('BEGIN');

    // 1. Enable pgcrypto for random UUIDs
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    // 2. Add temporary UUID columns
    console.log('📦 Adding temporary UUID columns...');
    await client.query('ALTER TABLE users ADD COLUMN uuid_id UUID DEFAULT gen_random_uuid()');
    await client.query('ALTER TABLE products ADD COLUMN uuid_id UUID DEFAULT gen_random_uuid()');
    await client.query('ALTER TABLE orders ADD COLUMN uuid_id UUID DEFAULT gen_random_uuid()');
    await client.query('ALTER TABLE orders ADD COLUMN uuid_user_id UUID');
    await client.query('ALTER TABLE order_items ADD COLUMN uuid_id UUID DEFAULT gen_random_uuid()');
    await client.query('ALTER TABLE order_items ADD COLUMN uuid_order_id UUID');
    await client.query('ALTER TABLE order_items ADD COLUMN uuid_product_id UUID');
    await client.query('ALTER TABLE cart ADD COLUMN uuid_id UUID DEFAULT gen_random_uuid()');
    await client.query('ALTER TABLE cart ADD COLUMN uuid_user_id UUID');
    await client.query('ALTER TABLE cart ADD COLUMN uuid_product_id UUID');

    // 3. Map foreign keys
    console.log('🔗 Mapping foreign keys...');
    await client.query('UPDATE orders o SET uuid_user_id = u.uuid_id FROM users u WHERE o.user_id = u.id');
    await client.query('UPDATE order_items oi SET uuid_order_id = o.uuid_id FROM orders o WHERE oi.order_id = o.id');
    await client.query('UPDATE order_items oi SET uuid_product_id = p.uuid_id FROM products p WHERE oi.product_id = p.id');
    await client.query('UPDATE cart c SET uuid_user_id = u.uuid_id FROM users u WHERE c.user_id = u.id');
    await client.query('UPDATE cart c SET uuid_product_id = p.uuid_id FROM products p WHERE c.product_id = p.id');

    // 4. Drop old constraints and columns
    console.log('🗑️ Dropping old columns and constraints...');
    // We need to drop constraints first. This is tricky without knowing their names.
    // We'll use a more aggressive approach: Drop the tables' primary keys and recreate them.
    
    // Users
    await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey CASCADE');
    await client.query('ALTER TABLE users DROP COLUMN id');
    await client.query('ALTER TABLE users RENAME COLUMN uuid_id TO id');
    await client.query('ALTER TABLE users ADD PRIMARY KEY (id)');

    // Products
    await client.query('ALTER TABLE products DROP CONSTRAINT IF EXISTS products_pkey CASCADE');
    await client.query('ALTER TABLE products DROP COLUMN id');
    await client.query('ALTER TABLE products RENAME COLUMN uuid_id TO id');
    await client.query('ALTER TABLE products ADD PRIMARY KEY (id)');

    // Orders
    await client.query('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pkey CASCADE');
    await client.query('ALTER TABLE orders DROP COLUMN id');
    await client.query('ALTER TABLE orders DROP COLUMN user_id');
    await client.query('ALTER TABLE orders RENAME COLUMN uuid_id TO id');
    await client.query('ALTER TABLE orders RENAME COLUMN uuid_user_id TO user_id');
    await client.query('ALTER TABLE orders ADD PRIMARY KEY (id)');
    await client.query('ALTER TABLE orders ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');

    // Order Items
    await client.query('ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_pkey CASCADE');
    await client.query('ALTER TABLE order_items DROP COLUMN id');
    await client.query('ALTER TABLE order_items DROP COLUMN order_id');
    await client.query('ALTER TABLE order_items DROP COLUMN product_id');
    await client.query('ALTER TABLE order_items RENAME COLUMN uuid_id TO id');
    await client.query('ALTER TABLE order_items RENAME COLUMN uuid_order_id TO order_id');
    await client.query('ALTER TABLE order_items RENAME COLUMN uuid_product_id TO product_id');
    await client.query('ALTER TABLE order_items ADD PRIMARY KEY (id)');
    await client.query('ALTER TABLE order_items ADD CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE');
    await client.query('ALTER TABLE order_items ADD CONSTRAINT fk_oi_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE');

    // Cart
    await client.query('ALTER TABLE cart DROP CONSTRAINT IF EXISTS cart_pkey CASCADE');
    await client.query('ALTER TABLE cart DROP COLUMN id');
    await client.query('ALTER TABLE cart DROP COLUMN user_id');
    await client.query('ALTER TABLE cart DROP COLUMN product_id');
    await client.query('ALTER TABLE cart RENAME COLUMN uuid_id TO id');
    await client.query('ALTER TABLE cart RENAME COLUMN uuid_user_id TO user_id');
    await client.query('ALTER TABLE cart RENAME COLUMN uuid_product_id TO product_id');
    await client.query('ALTER TABLE cart ADD PRIMARY KEY (id)');
    await client.query('ALTER TABLE cart ADD CONSTRAINT fk_cart_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
    await client.query('ALTER TABLE cart ADD CONSTRAINT fk_cart_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE');
    await client.query('ALTER TABLE cart ADD CONSTRAINT cart_user_id_product_id_key UNIQUE (user_id, product_id)');

    await client.query('COMMIT');
    console.log('✅ UUID Migration Completed Successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
