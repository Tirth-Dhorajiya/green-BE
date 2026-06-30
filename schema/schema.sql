-- =============================================
-- Green Plant Store — Full Database Schema
-- =============================================

-- Enable uuid extension (optional but recommended)
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- USERS
-- =============================================
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100)        NOT NULL,
  email       VARCHAR(150)        UNIQUE NOT NULL,
  password    VARCHAR(255)        NOT NULL,
  role        VARCHAR(10)         NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at  TIMESTAMP           NOT NULL DEFAULT NOW()
);

-- =============================================
-- PRODUCTS
-- =============================================
CREATE TABLE IF NOT EXISTS products (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(200)        NOT NULL,
  description  TEXT,
  price        NUMERIC(10, 2)      NOT NULL CHECK (price >= 0),
  category     VARCHAR(50)         NOT NULL CHECK (category IN ('plants', 'seeds', 'tools', 'other')),
  stock        INTEGER             NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image_url    VARCHAR(500),
  created_at   TIMESTAMP           NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP           NOT NULL DEFAULT NOW()
);

-- =============================================
-- ORDERS
-- =============================================
CREATE TABLE IF NOT EXISTS orders (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_price  NUMERIC(10, 2)      NOT NULL CHECK (total_price >= 0),
  status       VARCHAR(20)         NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
  created_at   TIMESTAMP           NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP           NOT NULL DEFAULT NOW()
);

-- =============================================
-- ORDER ITEMS
-- =============================================
CREATE TABLE IF NOT EXISTS order_items (
  id           SERIAL PRIMARY KEY,
  order_id     INTEGER             NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER             NOT NULL REFERENCES products(id) ON DELETE SET NULL,
  quantity     INTEGER             NOT NULL CHECK (quantity > 0),
  price        NUMERIC(10, 2)      NOT NULL CHECK (price >= 0)
);

-- =============================================
-- CART
-- =============================================
CREATE TABLE IF NOT EXISTS cart (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id   INTEGER             NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity     INTEGER             NOT NULL DEFAULT 1 CHECK (quantity > 0),
  added_at     TIMESTAMP           NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, product_id)
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_products_category    ON products(category);
CREATE INDEX IF NOT EXISTS idx_orders_user_id       ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_cart_user_id         ON cart(user_id);

-- =============================================
-- SEED: Default Admin User
-- (Password: admin123 — change immediately in prod)
-- bcrypt hash for "admin123"
-- =============================================
INSERT INTO users (name, email, password, role)
VALUES ('Admin', 'admin@greenstore.com',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        'admin')
ON CONFLICT (email) DO NOTHING;
