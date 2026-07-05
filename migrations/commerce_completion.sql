-- Green commerce completion migration.
-- Run after the UUID migration on an existing database, or use schema/schema.sql for a fresh database.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS thumbnail_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_category_check;

ALTER TABLE products
  ADD CONSTRAINT products_category_check
  CHECK (category IN ('plants', 'seeds', 'tools', 'planters', 'other'));

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_address JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(30),
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(150),
  ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(150),
  ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(150);

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded'));

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

CREATE INDEX IF NOT EXISTS idx_products_featured    ON products(is_featured);
CREATE INDEX IF NOT EXISTS idx_reviews_product_id   ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id      ON reviews(user_id);
