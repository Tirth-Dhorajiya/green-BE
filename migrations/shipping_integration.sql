-- Delhivery B2C multi-parcel shipping, tracking, and pickup support.

CREATE TABLE IF NOT EXISTS shipping_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider VARCHAR(30) NOT NULL DEFAULT 'delhivery',
  provider_reference VARCHAR(50) NOT NULL UNIQUE,
  provider_upload_id VARCHAR(100),
  ewaybill_number VARCHAR(30),
  pickup_location VARCHAR(160) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'manifested', 'in_transit', 'delivered', 'cancelled', 'partial', 'failed')),
  failure_message TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  manifested_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shipping_shipments ADD COLUMN IF NOT EXISTS ewaybill_number VARCHAR(30);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shipping_shipments_active_order
  ON shipping_shipments(order_id)
  WHERE status IN ('creating', 'manifested', 'in_transit', 'partial');

CREATE TABLE IF NOT EXISTS shipping_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipping_shipments(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  waybill VARCHAR(80) UNIQUE,
  weight_grams NUMERIC(10, 2) NOT NULL CHECK (weight_grams > 0),
  length_cm NUMERIC(10, 2) NOT NULL CHECK (length_cm > 0),
  width_cm NUMERIC(10, 2) NOT NULL CHECK (width_cm > 0),
  height_cm NUMERIC(10, 2) NOT NULL CHECK (height_cm > 0),
  contents VARCHAR(500) NOT NULL,
  status VARCHAR(80) NOT NULL DEFAULT 'creating',
  status_code VARCHAR(80),
  status_type VARCHAR(40),
  status_description TEXT,
  status_location VARCHAR(250),
  estimated_delivery_date DATE,
  last_event_at TIMESTAMPTZ,
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shipment_id, sequence)
);

CREATE TABLE IF NOT EXISTS shipment_tracking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES shipping_packages(id) ON DELETE CASCADE,
  event_key VARCHAR(128) NOT NULL,
  status VARCHAR(100) NOT NULL,
  status_code VARCHAR(80),
  status_type VARCHAR(40),
  location VARCHAR(250),
  instructions TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(package_id, event_key)
);

CREATE TABLE IF NOT EXISTS shipping_pickup_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR(30) NOT NULL DEFAULT 'delhivery',
  provider_pickup_id VARCHAR(120),
  pickup_location VARCHAR(160) NOT NULL,
  pickup_date DATE NOT NULL,
  pickup_time TIME NOT NULL,
  expected_package_count INTEGER NOT NULL CHECK (expected_package_count > 0),
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled', 'failed')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipping_shipments_order_id ON shipping_shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipping_shipments_status ON shipping_shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipping_packages_shipment_id ON shipping_packages(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipping_packages_waybill ON shipping_packages(waybill);
CREATE INDEX IF NOT EXISTS idx_shipment_tracking_events_package_id ON shipment_tracking_events(package_id);
CREATE INDEX IF NOT EXISTS idx_shipment_tracking_events_occurred_at ON shipment_tracking_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_shipping_pickup_requests_date ON shipping_pickup_requests(pickup_date);
