-- TEST DATA ONLY: creates 13 verified reviews for this product:
-- 6bf17db2-deae-467d-bed3-e176641a87a4 (currently named "testing")
--
-- The script is idempotent. Running it again updates the same seed records.
-- All mock customer emails use the reserved example.test domain.
-- Shared local test password: MockReview123!
--
-- To remove everything created by this seed later, run:
-- DELETE FROM users WHERE email LIKE 'review.seed.%@example.test';
-- The related orders, order items, and reviews are removed by foreign-key cascades.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM products
    WHERE id = '6bf17db2-deae-467d-bed3-e176641a87a4'::uuid
  ) THEN
    RAISE EXCEPTION 'Product 6bf17db2-deae-467d-bed3-e176641a87a4 does not exist';
  END IF;
END $$;

WITH seed_users(id, name, email) AS (
  VALUES
    ('d0000000-0000-4000-8000-000000000001'::uuid, 'Ananya (Test)', 'review.seed.01@example.test'),
    ('d0000000-0000-4000-8000-000000000002'::uuid, 'Rohit (Test)',  'review.seed.02@example.test'),
    ('d0000000-0000-4000-8000-000000000003'::uuid, 'Kavya (Test)',  'review.seed.03@example.test'),
    ('d0000000-0000-4000-8000-000000000004'::uuid, 'Arjun (Test)',  'review.seed.04@example.test'),
    ('d0000000-0000-4000-8000-000000000005'::uuid, 'Meera (Test)',  'review.seed.05@example.test'),
    ('d0000000-0000-4000-8000-000000000006'::uuid, 'Vikram (Test)', 'review.seed.06@example.test'),
    ('d0000000-0000-4000-8000-000000000007'::uuid, 'Ishita (Test)', 'review.seed.07@example.test'),
    ('d0000000-0000-4000-8000-000000000008'::uuid, 'Nikhil (Test)', 'review.seed.08@example.test'),
    ('d0000000-0000-4000-8000-000000000009'::uuid, 'Diya (Test)',   'review.seed.09@example.test'),
    ('d0000000-0000-4000-8000-000000000010'::uuid, 'Aman (Test)',   'review.seed.10@example.test'),
    ('d0000000-0000-4000-8000-000000000011'::uuid, 'Sneha (Test)',  'review.seed.11@example.test'),
    ('d0000000-0000-4000-8000-000000000012'::uuid, 'Rahul (Test)',  'review.seed.12@example.test'),
    ('d0000000-0000-4000-8000-000000000013'::uuid, 'Pooja (Test)',  'review.seed.13@example.test')
)
INSERT INTO users (id, name, email, password, role, address, email_verified, created_at)
SELECT
  id,
  name,
  email,
  crypt('MockReview123!', gen_salt('bf')),
  'user',
  '{"city":"Test City","state":"Test State","country":"India","postalCode":"110001"}'::jsonb,
  TRUE,
  NOW() - INTERVAL '60 days'
FROM seed_users
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  role = 'user',
  email_verified = TRUE;

WITH seed_orders(id, user_id, sequence, delivered_days_ago) AS (
  VALUES
    ('e0000000-0000-4000-8000-000000000001'::uuid, 'd0000000-0000-4000-8000-000000000001'::uuid,  1, 28),
    ('e0000000-0000-4000-8000-000000000002'::uuid, 'd0000000-0000-4000-8000-000000000002'::uuid,  2, 27),
    ('e0000000-0000-4000-8000-000000000003'::uuid, 'd0000000-0000-4000-8000-000000000003'::uuid,  3, 26),
    ('e0000000-0000-4000-8000-000000000004'::uuid, 'd0000000-0000-4000-8000-000000000004'::uuid,  4, 25),
    ('e0000000-0000-4000-8000-000000000005'::uuid, 'd0000000-0000-4000-8000-000000000005'::uuid,  5, 24),
    ('e0000000-0000-4000-8000-000000000006'::uuid, 'd0000000-0000-4000-8000-000000000006'::uuid,  6, 23),
    ('e0000000-0000-4000-8000-000000000007'::uuid, 'd0000000-0000-4000-8000-000000000007'::uuid,  7, 22),
    ('e0000000-0000-4000-8000-000000000008'::uuid, 'd0000000-0000-4000-8000-000000000008'::uuid,  8, 21),
    ('e0000000-0000-4000-8000-000000000009'::uuid, 'd0000000-0000-4000-8000-000000000009'::uuid,  9, 20),
    ('e0000000-0000-4000-8000-000000000010'::uuid, 'd0000000-0000-4000-8000-000000000010'::uuid, 10, 19),
    ('e0000000-0000-4000-8000-000000000011'::uuid, 'd0000000-0000-4000-8000-000000000011'::uuid, 11, 18),
    ('e0000000-0000-4000-8000-000000000012'::uuid, 'd0000000-0000-4000-8000-000000000012'::uuid, 12, 17),
    ('e0000000-0000-4000-8000-000000000013'::uuid, 'd0000000-0000-4000-8000-000000000013'::uuid, 13, 16)
)
INSERT INTO orders (
  id, user_id, total_price, subtotal_price, discount_amount, status,
  shipping_address, payment_status, payment_provider, payment_reference,
  razorpay_order_id, razorpay_payment_id, delivered_at, created_at, updated_at
)
SELECT
  seed.id,
  seed.user_id,
  product.price,
  product.price,
  0,
  'delivered',
  jsonb_build_object(
    'name', 'Mock Review Customer',
    'phone', '9999999999',
    'address', 'Testing address only',
    'city', 'Test City',
    'state', 'Test State',
    'postalCode', '110001',
    'country', 'India'
  ),
  'paid',
  'razorpay',
  'mock_review_payment_' || LPAD(seed.sequence::text, 2, '0'),
  'order_mock_review_' || LPAD(seed.sequence::text, 2, '0'),
  'pay_mock_review_' || LPAD(seed.sequence::text, 2, '0'),
  NOW() - seed.delivered_days_ago * INTERVAL '1 day',
  NOW() - (seed.delivered_days_ago + 5) * INTERVAL '1 day',
  NOW() - seed.delivered_days_ago * INTERVAL '1 day'
FROM seed_orders seed
CROSS JOIN products product
WHERE product.id = '6bf17db2-deae-467d-bed3-e176641a87a4'::uuid
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id,
  total_price = EXCLUDED.total_price,
  subtotal_price = EXCLUDED.subtotal_price,
  discount_amount = 0,
  status = 'delivered',
  payment_status = 'paid',
  payment_provider = 'razorpay',
  payment_reference = EXCLUDED.payment_reference,
  razorpay_order_id = EXCLUDED.razorpay_order_id,
  razorpay_payment_id = EXCLUDED.razorpay_payment_id,
  delivered_at = EXCLUDED.delivered_at,
  updated_at = EXCLUDED.updated_at;

WITH seed_items(id, order_id) AS (
  VALUES
    ('a0000000-0000-4000-8000-000000000001'::uuid, 'e0000000-0000-4000-8000-000000000001'::uuid),
    ('a0000000-0000-4000-8000-000000000002'::uuid, 'e0000000-0000-4000-8000-000000000002'::uuid),
    ('a0000000-0000-4000-8000-000000000003'::uuid, 'e0000000-0000-4000-8000-000000000003'::uuid),
    ('a0000000-0000-4000-8000-000000000004'::uuid, 'e0000000-0000-4000-8000-000000000004'::uuid),
    ('a0000000-0000-4000-8000-000000000005'::uuid, 'e0000000-0000-4000-8000-000000000005'::uuid),
    ('a0000000-0000-4000-8000-000000000006'::uuid, 'e0000000-0000-4000-8000-000000000006'::uuid),
    ('a0000000-0000-4000-8000-000000000007'::uuid, 'e0000000-0000-4000-8000-000000000007'::uuid),
    ('a0000000-0000-4000-8000-000000000008'::uuid, 'e0000000-0000-4000-8000-000000000008'::uuid),
    ('a0000000-0000-4000-8000-000000000009'::uuid, 'e0000000-0000-4000-8000-000000000009'::uuid),
    ('a0000000-0000-4000-8000-000000000010'::uuid, 'e0000000-0000-4000-8000-000000000010'::uuid),
    ('a0000000-0000-4000-8000-000000000011'::uuid, 'e0000000-0000-4000-8000-000000000011'::uuid),
    ('a0000000-0000-4000-8000-000000000012'::uuid, 'e0000000-0000-4000-8000-000000000012'::uuid),
    ('a0000000-0000-4000-8000-000000000013'::uuid, 'e0000000-0000-4000-8000-000000000013'::uuid)
)
INSERT INTO order_items (
  id, order_id, product_id, quantity, price, product_name_snapshot,
  category_snapshot, return_policy_snapshot, return_window_hours_snapshot,
  final_sale_snapshot, net_unit_amount
)
SELECT
  seed.id,
  seed.order_id,
  product.id,
  1,
  product.price,
  product.name,
  product.category,
  product.return_policy,
  product.return_window_hours,
  product.final_sale,
  product.price
FROM seed_items seed
CROSS JOIN products product
WHERE product.id = '6bf17db2-deae-467d-bed3-e176641a87a4'::uuid
ON CONFLICT (id) DO UPDATE SET
  product_id = EXCLUDED.product_id,
  quantity = 1,
  price = EXCLUDED.price,
  product_name_snapshot = EXCLUDED.product_name_snapshot,
  category_snapshot = EXCLUDED.category_snapshot,
  return_policy_snapshot = EXCLUDED.return_policy_snapshot,
  return_window_hours_snapshot = EXCLUDED.return_window_hours_snapshot,
  final_sale_snapshot = EXCLUDED.final_sale_snapshot,
  net_unit_amount = EXCLUDED.net_unit_amount;

WITH seed_reviews(id, user_id, order_id, rating, comment, days_ago) AS (
  VALUES
    ('f0000000-0000-4000-8000-000000000001'::uuid, 'd0000000-0000-4000-8000-000000000001'::uuid, 'e0000000-0000-4000-8000-000000000001'::uuid, 5, 'The plant arrived upright and securely packed. The leaves looked fresh and it settled into its new spot quickly.', 13),
    ('f0000000-0000-4000-8000-000000000002'::uuid, 'd0000000-0000-4000-8000-000000000002'::uuid, 'e0000000-0000-4000-8000-000000000002'::uuid, 4, 'Healthy plant and good packaging. It was slightly smaller than I expected, but the condition was excellent.', 12),
    ('f0000000-0000-4000-8000-000000000003'::uuid, 'd0000000-0000-4000-8000-000000000003'::uuid, 'e0000000-0000-4000-8000-000000000003'::uuid, 5, 'Very happy with this purchase. The soil stayed in place during delivery and there was no damage to the stems.', 11),
    ('f0000000-0000-4000-8000-000000000004'::uuid, 'd0000000-0000-4000-8000-000000000004'::uuid, 'e0000000-0000-4000-8000-000000000004'::uuid, 4, 'Delivery was on time and the plant matched the photos well. New growth appeared within the first week.', 10),
    ('f0000000-0000-4000-8000-000000000005'::uuid, 'd0000000-0000-4000-8000-000000000005'::uuid, 'e0000000-0000-4000-8000-000000000005'::uuid, 5, 'Beautiful, compact plant with clean leaves. The care instructions were easy to follow and useful for a beginner.', 9),
    ('f0000000-0000-4000-8000-000000000006'::uuid, 'd0000000-0000-4000-8000-000000000006'::uuid, 'e0000000-0000-4000-8000-000000000006'::uuid, 3, 'The plant is doing well now, although two leaves were bent when it arrived. Packaging could be improved around the top.', 8),
    ('f0000000-0000-4000-8000-000000000007'::uuid, 'd0000000-0000-4000-8000-000000000007'::uuid, 'e0000000-0000-4000-8000-000000000007'::uuid, 5, 'Excellent quality for the price. The roots looked healthy and the plant did not show signs of stress after unpacking.', 7),
    ('f0000000-0000-4000-8000-000000000008'::uuid, 'd0000000-0000-4000-8000-000000000008'::uuid, 'e0000000-0000-4000-8000-000000000008'::uuid, 4, 'A good addition to my balcony collection. The color is vibrant and the size works perfectly for a small shelf.', 6),
    ('f0000000-0000-4000-8000-000000000009'::uuid, 'd0000000-0000-4000-8000-000000000009'::uuid, 'e0000000-0000-4000-8000-000000000009'::uuid, 5, 'Packed with a lot of care and delivered without any spilled soil. I would order another one as a gift.', 5),
    ('f0000000-0000-4000-8000-000000000010'::uuid, 'd0000000-0000-4000-8000-000000000010'::uuid, 'e0000000-0000-4000-8000-000000000010'::uuid, 4, 'The plant was fresh and well hydrated on arrival. It needed a day near indirect light and then looked great.', 4),
    ('f0000000-0000-4000-8000-000000000011'::uuid, 'd0000000-0000-4000-8000-000000000011'::uuid, 'e0000000-0000-4000-8000-000000000011'::uuid, 5, 'This was my first online plant order and the experience was smooth. Healthy leaves, neat packing, and clear updates.', 3),
    ('f0000000-0000-4000-8000-000000000012'::uuid, 'd0000000-0000-4000-8000-000000000012'::uuid, 'e0000000-0000-4000-8000-000000000012'::uuid, 3, 'Overall a decent plant, but one lower leaf had yellowed. The rest of the plant was healthy and recovered quickly.', 2),
    ('f0000000-0000-4000-8000-000000000013'::uuid, 'd0000000-0000-4000-8000-000000000013'::uuid, 'e0000000-0000-4000-8000-000000000013'::uuid, 5, 'The plant looks lovely on my desk and arrived exactly when promised. Strong packaging and very good condition.', 1)
)
INSERT INTO reviews (id, product_id, user_id, order_id, rating, comment, status, created_at, updated_at)
SELECT
  seed.id,
  '6bf17db2-deae-467d-bed3-e176641a87a4'::uuid,
  seed.user_id,
  seed.order_id,
  seed.rating,
  seed.comment,
  'visible',
  NOW() - seed.days_ago * INTERVAL '1 day',
  NOW() - seed.days_ago * INTERVAL '1 day'
FROM seed_reviews seed
ON CONFLICT (product_id, user_id, order_id) DO UPDATE SET
  rating = EXCLUDED.rating,
  comment = EXCLUDED.comment,
  status = 'visible',
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at;

COMMIT;

-- Verification result: should return 13 rows and an average rating around 4.38.
SELECT
  COUNT(*)::int AS seeded_review_count,
  ROUND(AVG(rating)::numeric, 2) AS seeded_average_rating
FROM reviews
WHERE product_id = '6bf17db2-deae-467d-bed3-e176641a87a4'::uuid
  AND user_id IN (
    SELECT id FROM users WHERE email LIKE 'review.seed.%@example.test'
  );
