const test = require('node:test');
const assert = require('node:assert/strict');

const productModel = require('../models/productModel');
const growingGuide = require('../services/growingGuideService');

test('validates all zero-admin growing datasets at startup', () => {
  assert.deepEqual(growingGuide.validationSummary, {
    regions: 7,
    locations: 47,
    crops: 36,
    version: '2026.1',
  });
  assert.deepEqual(growingGuide.validateDatasets(), growingGuide.validationSummary);
});

test('searches current and alternate Indian city names', () => {
  const currentName = growingGuide.searchLocations('Bengaluru');
  const formerName = growingGuide.searchLocations('Bangalore');
  assert.equal(currentName[0].id, 'bengaluru-karnataka');
  assert.equal(formerName[0].id, 'bengaluru-karnataka');
  assert.equal(formerName[0].region, 'southern-tropical');
});

test('uses complete-word matching and rejects ambiguous partial names', () => {
  const crop = {
    slug: 'tomato',
    aliases: ['tomato', 'tamatar', 'cherry tomato'],
  };
  const matched = growingGuide.matchCropProducts(crop, [
    { id: '1', name: 'Cherry Tomato Seeds', description: '', category: 'seeds', stock: 5, is_featured: false },
    { id: '2', name: 'Tomato Fertilizer', description: '', category: 'other', stock: 8, is_featured: true },
    { id: '3', name: 'Tomatillo Seeds', description: '', category: 'seeds', stock: 10, is_featured: true },
  ]);
  assert.deepEqual(matched.map((product) => product.id), ['1']);
  assert.equal(growingGuide.hasWholePhrase('Tomatillo Seeds', 'tomato'), false);
});

test('filters recommendations by region, space, type and beginner experience', async (t) => {
  const original = productModel.getGrowingCandidates;
  productModel.getGrowingCandidates = async () => ({ rows: [
    { id: 'tomato-seed', name: 'Tomato Seeds', description: 'Grow tomato at home', category: 'seeds', price: '49.00', stock: 10, is_featured: true, created_at: new Date().toISOString() },
    { id: 'fertilizer', name: 'Tomato Fertilizer', description: '', category: 'other', price: '99.00', stock: 10, is_featured: false, created_at: new Date().toISOString() },
  ] });
  t.after(() => { productModel.getGrowingCandidates = original; });

  const result = await growingGuide.buildRecommendations({
    locationId: 'delhi-delhi',
    month: 2,
    space: 'balcony',
    type: 'vegetable',
    experience: 'beginner',
  });

  assert.equal(result.selection.region.slug, 'north-plains');
  assert.ok(result.recommendations.length > 0);
  assert.ok(result.recommendations.every((crop) => crop.type === 'vegetable' && crop.difficulty === 'beginner' && crop.spaces.includes('balcony')));
  const tomato = result.recommendations.find((crop) => crop.slug === 'tomato');
  assert.equal(tomato.primary_product.id, 'tomato-seed');
  assert.equal(tomato.alternative_products.length, 0);
});

test('looks ahead no more than two months without changing other filters', async (t) => {
  const original = productModel.getGrowingCandidates;
  productModel.getGrowingCandidates = async () => ({ rows: [] });
  t.after(() => { productModel.getGrowingCandidates = original; });

  const result = await growingGuide.buildRecommendations({
    region: 'north-plains',
    month: 5,
    space: 'terrace',
    type: 'vegetable',
    experience: 'beginner',
  });
  assert.equal(result.coming_soon, true);
  assert.equal(result.selection.result_month, 6);
  assert.ok(result.recommendations.every((crop) => crop.coming_soon && crop.spaces.includes('terrace')));
});
