-- Green commerce completion migration.
-- Run after the UUID migration on an existing database, or use schema/schema.sql for a fresh database.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS address JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS email_otps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        VARCHAR(150)        NOT NULL,
  purpose      VARCHAR(30)         NOT NULL CHECK (purpose IN ('register', 'password_reset')),
  otp_hash     VARCHAR(255)        NOT NULL,
  expires_at   TIMESTAMP           NOT NULL,
  consumed_at  TIMESTAMP,
  created_at   TIMESTAMP           NOT NULL DEFAULT NOW()
);

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
  ADD COLUMN IF NOT EXISTS subtotal_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50),
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

ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50);

CREATE TABLE IF NOT EXISTS coupons (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 VARCHAR(50)          UNIQUE NOT NULL,
  description          TEXT,
  discount_type        VARCHAR(10)          NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value       NUMERIC(10, 2)       NOT NULL CHECK (discount_value > 0),
  min_order_amount     NUMERIC(10, 2)       NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
  max_discount_amount  NUMERIC(10, 2)       CHECK (max_discount_amount IS NULL OR max_discount_amount >= 0),
  starts_at            TIMESTAMP,
  expires_at           TIMESTAMP,
  usage_limit          INTEGER             CHECK (usage_limit IS NULL OR usage_limit > 0),
  used_count           INTEGER             NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  is_active            BOOLEAN             NOT NULL DEFAULT true,
  created_at           TIMESTAMP           NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP           NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wishlist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID                 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  UUID                 NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  TIMESTAMP            NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, product_id)
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
CREATE INDEX IF NOT EXISTS idx_email_otps_email     ON email_otps(email);
CREATE INDEX IF NOT EXISTS idx_wishlist_user_id     ON wishlist(user_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code         ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_reviews_product_id   ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id      ON reviews(user_id);

INSERT INTO coupons (code, description, discount_type, discount_value, min_order_amount, max_discount_amount)
VALUES ('GREEN10', '10% off orders over 500', 'percent', 10, 500, 250)
ON CONFLICT (code) DO NOTHING;
