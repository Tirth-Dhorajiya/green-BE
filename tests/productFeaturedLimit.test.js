const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/db');
const productModel = require('../models/productModel');

test('caps featured products at ten and rolls back the attempted update', async (t) => {
  const originalConnect = db.pool.connect;
  const statements = [];
  let released = false;

  db.pool.connect = async () => ({
    query: async (sql) => {
      statements.push(sql);
      if (sql.startsWith('SELECT id')) return { rows: [{ id: 'product-11' }] };
      if (sql.startsWith('SELECT COUNT')) return { rows: [{ count: '10' }] };
      return { rows: [] };
    },
    release: () => { released = true; },
  });
  t.after(() => { db.pool.connect = originalConnect; });

  await assert.rejects(
    productModel.setFeatured('product-11', true),
    (error) => error.code === 'FEATURED_PRODUCT_LIMIT' && error.statusCode === 409
  );
  assert.equal(productModel.FEATURED_PRODUCT_LIMIT, 10);
  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
  assert.equal(released, true);
});

test('allows a product to be featured when fewer than ten are selected', async (t) => {
  const originalConnect = db.pool.connect;
  const statements = [];

  db.pool.connect = async () => ({
    query: async (sql) => {
      statements.push(sql);
      if (sql.startsWith('SELECT id')) return { rows: [{ id: 'product-10' }] };
      if (sql.startsWith('SELECT COUNT')) return { rows: [{ count: '9' }] };
      if (sql.startsWith('UPDATE products')) return { rows: [{ id: 'product-10', is_featured: true }] };
      return { rows: [] };
    },
    release: () => {},
  });
  t.after(() => { db.pool.connect = originalConnect; });

  const result = await productModel.setFeatured('product-10', true);
  assert.equal(result.rows[0].is_featured, true);
  assert.ok(statements.includes('COMMIT'));
});
