-- Run this migration once to add multi-image support
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;

-- images column stores an array of objects:
-- [{ "url": "https://...", "is_default": true, "is_thumbnail": false }, ...]
