const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const reviewModel = require('../models/reviewModel');

test('stores a review and its photos in one transaction with stable ordering', async () => {
  const originalConnect = db.pool.connect;
  const calls = [];
  let released = false;

  db.pool.connect = async () => ({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO reviews')) {
        return { rows: [{ id: 'review-1', rating: 5, comment: 'Healthy plant' }] };
      }
      if (sql.includes('INSERT INTO review_images')) {
        return {
          rows: [{
            id: `image-${params[3] + 1}`,
            url: params[1],
            public_id: params[2],
            sort_order: params[3],
            status: 'visible',
          }],
        };
      }
      return { rows: [] };
    },
    release: () => { released = true; },
  });

  try {
    const result = await reviewModel.createReview({
      productId: 'product-1',
      userId: 'user-1',
      orderId: 'order-1',
      rating: 5,
      comment: 'Healthy plant',
      images: [
        { url: 'https://example.test/one.webp', public_id: 'reviews/one' },
        { url: 'https://example.test/two.webp', public_id: 'reviews/two' },
      ],
    });

    assert.deepEqual(result.rows[0].images.map((image) => image.sort_order), [0, 1]);
    assert.equal(calls[0].sql, 'BEGIN');
    assert.equal(calls.at(-1).sql, 'COMMIT');
    assert.equal(released, true);
  } finally {
    db.pool.connect = originalConnect;
  }
});

test('rolls back when a review photo row cannot be stored', async () => {
  const originalConnect = db.pool.connect;
  const statements = [];
  let released = false;

  db.pool.connect = async () => ({
    query: async (sql) => {
      statements.push(sql);
      if (sql.includes('INSERT INTO reviews')) return { rows: [{ id: 'review-2' }] };
      if (sql.includes('INSERT INTO review_images')) throw new Error('image insert failed');
      return { rows: [] };
    },
    release: () => { released = true; },
  });

  try {
    await assert.rejects(
      reviewModel.createReview({
        productId: 'product-1',
        userId: 'user-1',
        orderId: 'order-1',
        rating: 4,
        comment: '',
        images: [{ url: 'https://example.test/one.webp', public_id: 'reviews/one' }],
      }),
      /image insert failed/
    );
    assert.equal(statements.at(-1), 'ROLLBACK');
    assert.equal(released, true);
  } finally {
    db.pool.connect = originalConnect;
  }
});
