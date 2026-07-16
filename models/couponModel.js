const db = require('../config/db');

const normalizeCode = (code) => String(code || '').trim().toUpperCase();

const findActiveByCode = (code) =>
  db.query(
    `SELECT *
     FROM coupons
     WHERE code = $1
       AND is_active = true
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (expires_at IS NULL OR expires_at >= NOW())
       AND (usage_limit IS NULL OR used_count < usage_limit)`,
    [normalizeCode(code)]
  );

const getAll = () =>
  db.query(
    `SELECT *
     FROM coupons
     ORDER BY created_at DESC`
  );

const create = ({ code, description, discount_type, discount_value, min_order_amount, max_discount_amount, expires_at, usage_limit, is_active }) =>
  db.query(
    `INSERT INTO coupons (
       code, description, discount_type, discount_value,
       min_order_amount, max_discount_amount, expires_at, usage_limit, is_active
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      normalizeCode(code),
      description || null,
      discount_type,
      discount_value,
      min_order_amount || 0,
      max_discount_amount || null,
      expires_at || null,
      usage_limit || null,
      is_active !== false,
    ]
  );

const update = (id, fields) => {
  const allowed = [
    'code',
    'description',
    'discount_type',
    'discount_value',
    'min_order_amount',
    'max_discount_amount',
    'expires_at',
    'usage_limit',
    'is_active',
  ];
  const keys = Object.keys(fields).filter((key) => allowed.includes(key));
  const values = keys.map((key) => {
    if (key === 'code') return normalizeCode(fields[key]);
    if (['description', 'max_discount_amount', 'expires_at', 'usage_limit'].includes(key) && fields[key] === '') return null;
    return fields[key];
  });

  if (!keys.length) {
    return db.query('SELECT * FROM coupons WHERE id = $1', [id]);
  }

  const setClause = keys.map((key, index) => `${key} = $${index + 1}`).join(', ');
  values.push(id);
  return db.query(
    `UPDATE coupons SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
    values
  );
};

const incrementUsage = (code) =>
  db.query('UPDATE coupons SET used_count = used_count + 1, updated_at = NOW() WHERE code = $1', [normalizeCode(code)]);

const calculateDiscount = (coupon, subtotal) => {
  const amount = Number(subtotal);
  if (!coupon || amount < Number(coupon.min_order_amount || 0)) return 0;

  const rawDiscount = coupon.discount_type === 'percent'
    ? amount * (Number(coupon.discount_value) / 100)
    : Number(coupon.discount_value);
  const cappedDiscount = coupon.max_discount_amount
    ? Math.min(rawDiscount, Number(coupon.max_discount_amount))
    : rawDiscount;

  return Math.min(amount, Number(cappedDiscount.toFixed(2)));
};

module.exports = { normalizeCode, findActiveByCode, getAll, create, update, incrementUsage, calculateDiscount };
