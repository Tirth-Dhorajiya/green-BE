-- =============================================
-- Green Plant Store - Full Database Schema
-- =============================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- USERS
-- =============================================
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(200)        NOT NULL,
  description    TEXT,
  price          NUMERIC(10, 2)      NOT NULL CHECK (price >= 0),
  category       VARCHAR(50)         NOT NULL CHECK (category IN ('plants', 'seeds', 'tools', 'planters', 'other')),
  stock          INTEGER             NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image_url      VARCHAR(500),
  thumbnail_url  VARCHAR(500),
  images         JSONB               NOT NULL DEFAULT '[]'::jsonb,
  is_featured    BOOLEAN             NOT NULL DEFAULT false,
  created_at     TIMESTAMP           NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP           NOT NULL DEFAULT NOW()
);

-- =============================================
-- ORDERS
-- =============================================
CREATE TABLE IF NOT EXISTS orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID                 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_price          NUMERIC(10, 2)       NOT NULL CHECK (total_price >= 0),
  status               VARCHAR(20)          NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
  shipping_address     JSONB                NOT NULL DEFAULT '{}'::jsonb,
  payment_status       VARCHAR(20)          NOT NULL DEFAULT 'pending'
                         CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  payment_provider     VARCHAR(30),
  payment_reference    VARCHAR(150),
  razorpay_order_id    VARCHAR(150),
  razorpay_payment_id  VARCHAR(150),
  created_at           TIMESTAMP            NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP            NOT NULL DEFAULT NOW()
);

-- =============================================
-- ORDER ITEMS
-- =============================================
CREATE TABLE IF NOT EXISTS order_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID                 NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   UUID                 NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity     INTEGER              NOT NULL CHECK (quantity > 0),
  price        NUMERIC(10, 2)       NOT NULL CHECK (price >= 0)
);

-- =============================================
-- CART
-- =============================================
CREATE TABLE IF NOT EXISTS cart (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID                 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id   UUID                 NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity     INTEGER              NOT NULL DEFAULT 1 CHECK (quantity > 0),
  added_at     TIMESTAMP            NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, product_id)
);

-- =============================================
-- PAYMENT ATTEMPTS
-- =============================================
CREATE TABLE IF NOT EXISTS payment_attempts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID                 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  razorpay_order_id    VARCHAR(150)         UNIQUE NOT NULL,
  razorpay_payment_id  VARCHAR(150),
  amount               NUMERIC(10, 2)       NOT NULL CHECK (amount >= 0),
  currency             VARCHAR(10)          NOT NULL DEFAULT 'INR',
  status               VARCHAR(20)          NOT NULL DEFAULT 'created'
                         CHECK (status IN ('created', 'paid', 'failed')),
  shipping_address     JSONB                NOT NULL DEFAULT '{}'::jsonb,
  created_order_id     UUID                 REFERENCES orders(id) ON DELETE SET NULL,
  created_at           TIMESTAMP            NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP            NOT NULL DEFAULT NOW()
);

-- =============================================
-- REVIEWS
-- =============================================
CREATE TABLE IF NOT EXISTS reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID                 NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id     UUID                 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id    UUID                 NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  rating      INTEGER              NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  status      VARCHAR(20)          NOT NULL DEFAULT 'visible'
                CHECK (status IN ('visible', 'hidden')),
  created_at  TIMESTAMP            NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP            NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, user_id, order_id)
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_products_category    ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_featured    ON products(is_featured);
CREATE INDEX IF NOT EXISTS idx_orders_user_id       ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_cart_user_id         ON cart(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product_id   ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id      ON reviews(user_id);

-- =============================================
-- SEED: Default Admin User
-- Password: admin123 - change before production
-- =============================================
INSERT INTO users (name, email, password, role)
VALUES ('Admin', 'admin@greenstore.com',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        'admin')
ON CONFLICT (email) DO NOTHING;
