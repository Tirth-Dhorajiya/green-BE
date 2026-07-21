CREATE TABLE IF NOT EXISTS saved_growing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL CHECK (char_length(trim(name)) > 0),
  filters JSONB NOT NULL CHECK (jsonb_typeof(filters) = 'object'),
  crop_slugs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
    CHECK (cardinality(crop_slugs) BETWEEN 1 AND 50),
  dataset_version VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_growing_plans_user_created
  ON saved_growing_plans(user_id, created_at DESC);
