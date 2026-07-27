const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeProductDescription } = require('../services/productDescriptionService');

test('keeps supported product-description formatting', () => {
  const clean = sanitizeProductDescription('<h2>Care</h2><h3>Light</h3><p><strong>Bright</strong> <em>indirect</em> <u>light</u></p><ul><li>Water weekly</li></ul><hr><blockquote>Keep away from pets.</blockquote>');
  assert.equal(clean, '<h2>Care</h2><h3>Light</h3><p><strong>Bright</strong> <em>indirect</em> <u>light</u></p><ul><li>Water weekly</li></ul><hr><blockquote>Keep away from pets.</blockquote>');
});

test('removes scripts, event handlers, and unsafe links', () => {
  const clean = sanitizeProductDescription('<p onclick="alert(1)">Safe</p><script>alert(1)</script><a href="javascript:alert(1)">Link</a>');
  assert.equal(clean.includes('script'), false);
  assert.equal(clean.includes('onclick'), false);
  assert.equal(clean.includes('javascript:'), false);
  assert.equal(clean.includes('Safe'), true);
});

test('keeps safe links and adds secure new-tab attributes', () => {
  const clean = sanitizeProductDescription('<p>Read the <a class="button" href="https://example.com/guide" onclick="bad()">care guide</a>.</p>');
  assert.equal(clean, '<p>Read the <a href="https://example.com/guide" target="_blank" rel="noopener noreferrer">care guide</a>.</p>');
});

test('keeps plain text descriptions unchanged for legacy products', () => {
  assert.equal(sanitizeProductDescription('Healthy indoor plant'), 'Healthy indoor plant');
});
