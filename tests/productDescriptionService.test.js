const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeProductDescription } = require('../services/productDescriptionService');

test('keeps supported product-description formatting', () => {
  const clean = sanitizeProductDescription('<h2>Care</h2><p><strong>Bright</strong> light</p><ul><li>Water weekly</li></ul>');
  assert.equal(clean, '<h2>Care</h2><p><strong>Bright</strong> light</p><ul><li>Water weekly</li></ul>');
});

test('removes scripts, event handlers, and unsafe links', () => {
  const clean = sanitizeProductDescription('<p onclick="alert(1)">Safe</p><script>alert(1)</script><a href="javascript:alert(1)">Link</a>');
  assert.equal(clean.includes('script'), false);
  assert.equal(clean.includes('onclick'), false);
  assert.equal(clean.includes('javascript:'), false);
  assert.equal(clean.includes('Safe'), true);
});
