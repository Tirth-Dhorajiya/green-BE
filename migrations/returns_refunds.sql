-- Customer returns, reverse logistics, replacements, and real Razorpay refunds.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS return_policy VARCHAR(30),
  ADD COLUMN IF NOT EXISTS return_window_hours INTEGER,
  ADD COLUMN IF NOT EXISTS final_sale BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE products
SET return_policy = COALESCE(return_policy, CASE WHEN category = 'plants' THEN 'damage_only' ELSE 'returnable' END),
    return_window_hours = COALESCE(return_window_hours, CASE WHEN category = 'plants' THEN 48 ELSE 168 END);

ALTER TABLE products
  ALTER COLUMN return_policy SET DEFAULT 'returnable',
  ALTER COLUMN return_policy SET NOT NULL,
  ALTER COLUMN return_window_hours SET DEFAULT 168,
  ALTER COLUMN return_window_hours SET NOT NULL;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS product_name_snapshot VARCHAR(255),
  ADD COLUMN IF NOT EXISTS category_snapshot VARCHAR(50),
  ADD COLUMN IF NOT EXISTS return_policy_snapshot VARCHAR(30),
  ADD COLUMN IF NOT EXISTS return_window_hours_snapshot INTEGER,
  ADD COLUMN IF NOT EXISTS final_sale_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS net_unit_amount NUMERIC(12, 2);

UPDATE order_items oi
SET product_name_snapshot = COALESCE(oi.product_name_snapshot, p.name),
    category_snapshot = COALESCE(oi.category_snapshot, p.category),
    return_policy_snapshot = COALESCE(oi.return_policy_snapshot, CASE WHEN p.category = 'plants' THEN 'damage_only' ELSE 'returnable' END),
    return_window_hours_snapshot = COALESCE(oi.return_window_hours_snapshot, CASE WHEN p.category = 'plants' THEN 48 ELSE 168 END),
    final_sale_snapshot = COALESCE(oi.final_sale_snapshot, FALSE),
    net_unit_amount = COALESCE(oi.net_unit_amount, oi.price)
FROM products p WHERE p.id = oi.product_id;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
UPDATE orders SET delivered_at = COALESCE(delivered_at, updated_at) WHERE status = 'delivered';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('pending', 'paid', 'failed', 'refund_pending', 'partially_refunded', 'refunded'));

CREATE TABLE IF NOT EXISTS return_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number VARCHAR(40) NOT NULL UNIQUE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'rejected', 'reverse_pending', 'reverse_in_transit', 'received', 'resolution_pending', 'resolved', 'cancelled', 'exception')),
  preferred_resolution VARCHAR(20) NOT NULL CHECK (preferred_resolution IN ('refund', 'replacement')),
  resolution_type VARCHAR(20) CHECK (resolution_type IS NULL OR resolution_type IN ('refund', 'replacement', 'mixed', 'none')),
  inspection_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (inspection_status IN ('pending', 'passed', 'partial', 'failed', 'waived')),
  explanation TEXT,
  admin_reason TEXT,
  reverse_required BOOLEAN,
  manual_return BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_request_id UUID NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  reason VARCHAR(30) NOT NULL CHECK (reason IN ('damaged', 'dead', 'defective', 'missing', 'wrong_item', 'not_as_described', 'change_of_mind')),
  requested_amount_paise BIGINT NOT NULL CHECK (requested_amount_paise >= 0),
  approved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (approved_quantity >= 0),
  received_quantity INTEGER NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  accepted_quantity INTEGER NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0),
  refund_quantity INTEGER NOT NULL DEFAULT 0 CHECK (refund_quantity >= 0),
  replacement_quantity INTEGER NOT NULL DEFAULT 0 CHECK (replacement_quantity >= 0),
  condition_note TEXT,
  resellable BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(return_request_id, order_item_id)
);

CREATE TABLE IF NOT EXISTS return_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_request_id UUID NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  public_id TEXT,
  kind VARCHAR(30) NOT NULL DEFAULT 'product',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE return_items ADD COLUMN IF NOT EXISTS accepted_quantity INTEGER NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0);

CREATE TABLE IF NOT EXISTS return_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_request_id UUID NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  return_request_id UUID REFERENCES return_requests(id) ON DELETE SET NULL,
  parent_refund_id UUID REFERENCES payment_refunds(id) ON DELETE SET NULL,
  razorpay_payment_id VARCHAR(150) NOT NULL,
  razorpay_refund_id VARCHAR(150) UNIQUE,
  receipt VARCHAR(80) NOT NULL UNIQUE,
  idempotency_key VARCHAR(80) NOT NULL UNIQUE,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  status VARCHAR(20) NOT NULL DEFAULT 'creating' CHECK (status IN ('creating', 'pending', 'processed', 'failed')),
  speed_requested VARCHAR(20) NOT NULL DEFAULT 'normal',
  speed_processed VARCHAR(20),
  failure_code VARCHAR(100),
  failure_message TEXT,
  arn VARCHAR(150),
  initiated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS refund_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id VARCHAR(160) NOT NULL UNIQUE,
  event_type VARCHAR(80) NOT NULL,
  razorpay_refund_id VARCHAR(150),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS replacement_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_item_id UUID NOT NULL REFERENCES return_items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  shipment_id UUID,
  allocated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(return_item_id)
);

ALTER TABLE shipping_shipments
  ADD COLUMN IF NOT EXISTS direction VARCHAR(20) NOT NULL DEFAULT 'forward',
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(20) NOT NULL DEFAULT 'fulfilment',
  ADD COLUMN IF NOT EXISTS return_request_id UUID REFERENCES return_requests(id) ON DELETE SET NULL;
ALTER TABLE shipping_shipments DROP CONSTRAINT IF EXISTS shipping_shipments_status_check;
ALTER TABLE shipping_shipments ADD CONSTRAINT shipping_shipments_status_check
  CHECK (status IN ('creating', 'manifested', 'in_transit', 'delivered', 'cancelled', 'partial', 'failed', 'returning', 'returned', 'exception'));
ALTER TABLE shipping_shipments DROP CONSTRAINT IF EXISTS shipping_shipments_direction_check;
ALTER TABLE shipping_shipments ADD CONSTRAINT shipping_shipments_direction_check CHECK (direction IN ('forward', 'reverse'));
ALTER TABLE shipping_shipments DROP CONSTRAINT IF EXISTS shipping_shipments_purpose_check;
ALTER TABLE shipping_shipments ADD CONSTRAINT shipping_shipments_purpose_check CHECK (purpose IN ('fulfilment', 'return', 'replacement'));

DROP INDEX IF EXISTS uq_shipping_shipments_active_order;
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipping_shipments_active_fulfilment ON shipping_shipments(order_id)
  WHERE direction = 'forward' AND purpose = 'fulfilment' AND status IN ('creating', 'manifested', 'in_transit', 'partial', 'exception');
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipping_shipments_active_return ON shipping_shipments(return_request_id)
  WHERE direction = 'reverse' AND purpose = 'return' AND status IN ('creating', 'manifested', 'in_transit', 'partial', 'exception');

CREATE INDEX IF NOT EXISTS idx_return_requests_order ON return_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_user ON return_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_status ON return_requests(status);
CREATE INDEX IF NOT EXISTS idx_return_items_request ON return_items(return_request_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_order ON payment_refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_status ON payment_refunds(status);
CREATE INDEX IF NOT EXISTS idx_shipping_shipments_return ON shipping_shipments(return_request_id);
