-- Order fulfillment, tracking, and status audit support.
-- Run this after schema/schema.sql and migrations/commerce_completion.sql.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS courier_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(160),
  ADD COLUMN IF NOT EXISTS estimated_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS admin_notes TEXT;

CREATE TABLE IF NOT EXISTS order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status VARCHAR(20),
  to_status VARCHAR(20) NOT NULL
    CHECK (to_status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id
  ON order_status_history(order_id);

CREATE INDEX IF NOT EXISTS idx_orders_tracking_number
  ON orders(tracking_number);
