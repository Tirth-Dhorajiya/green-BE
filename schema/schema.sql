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
  address     JSONB               NOT NULL DEFAULT '{}'::jsonb,
  email_verified BOOLEAN          NOT NULL DEFAULT false,
  created_at  TIMESTAMP           NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_otps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        VARCHAR(150)        NOT NULL,
  purpose      VARCHAR(30)         NOT NULL CHECK (purpose IN ('register', 'password_reset')),
  otp_hash     VARCHAR(255)        NOT NULL,
  expires_at   TIMESTAMP           NOT NULL,
  consumed_at  TIMESTAMP,
  created_at   TIMESTAMP           NOT NULL DEFAULT NOW()
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
  subtotal_price       NUMERIC(10, 2)       NOT NULL DEFAULT 0 CHECK (subtotal_price >= 0),
  discount_amount      NUMERIC(10, 2)       NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  coupon_code          VARCHAR(50),
  status               VARCHAR(20)          NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
  shipping_address     JSONB                NOT NULL DEFAULT '{}'::jsonb,
  payment_status       VARCHAR(20)          NOT NULL DEFAULT 'pending'
                         CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  payment_provider     VARCHAR(30),
  payment_reference    VARCHAR(150),
  razorpay_order_id    VARCHAR(150),
  razorpay_payment_id  VARCHAR(150),
  courier_name         VARCHAR(120),
  tracking_number      VARCHAR(160),
  estimated_delivery_date DATE,
  admin_notes          TEXT,
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

CREATE TABLE IF NOT EXISTS wishlist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID                 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  UUID                 NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  TIMESTAMP            NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, product_id)
);

-- =============================================
-- COUPONS
-- =============================================
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

-- =============================================
-- PAYMENT ATTEMPTS
-- =============================================
CREATE TABLE IF NOT EXISTS payment_attempts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID                 NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  razorpay_order_id    VARCHAR(150)         UNIQUE NOT NULL,
  razorpay_payment_id  VARCHAR(150),
  amount               NUMERIC(10, 2)       NOT NULL CHECK (amount >= 0),
  subtotal_amount      NUMERIC(10, 2)       NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  discount_amount      NUMERIC(10, 2)       NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  coupon_code          VARCHAR(50),
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

CREATE TABLE IF NOT EXISTS order_status_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID                 NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status VARCHAR(20),
  to_status   VARCHAR(20)          NOT NULL CHECK (to_status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
  changed_by  UUID                 REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT,
  created_at  TIMESTAMP            NOT NULL DEFAULT NOW()
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_products_category    ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_featured    ON products(is_featured);
CREATE INDEX IF NOT EXISTS idx_orders_user_id       ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_tracking_number ON orders(tracking_number);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_cart_user_id         ON cart(user_id);
CREATE INDEX IF NOT EXISTS idx_email_otps_email     ON email_otps(email);
CREATE INDEX IF NOT EXISTS idx_wishlist_user_id     ON wishlist(user_id);
CREATE INDEX IF NOT EXISTS idx_coupons_code         ON coupons(code);
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

INSERT INTO coupons (code, description, discount_type, discount_value, min_order_amount, max_discount_amount)
VALUES ('GREEN10', '10% off orders over 500', 'percent', 10, 500, 250)
ON CONFLICT (code) DO NOTHING;
