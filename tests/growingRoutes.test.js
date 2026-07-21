const test = require('node:test');
const assert = require('node:assert/strict');

const productModel = require('../models/productModel');
const app = require('../server');

test('serves public growing options, locations and recommendations with validation', async (t) => {
  const original = productModel.getGrowingCandidates;
  productModel.getGrowingCandidates = async () => ({ rows: [] });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    productModel.getGrowingCandidates = original;
    await new Promise((resolve) => server.close(resolve));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const optionsResponse = await fetch(`${baseUrl}/api/growing/options`);
  const options = await optionsResponse.json();
  assert.equal(optionsResponse.status, 200);
  assert.equal(options.regions.length, 7);
  assert.match(optionsResponse.headers.get('cache-control'), /max-age=3600/);

  const locationsResponse = await fetch(`${baseUrl}/api/growing/locations?search=Bangalore`);
  const locations = await locationsResponse.json();
  assert.equal(locations.locations[0].id, 'bengaluru-karnataka');

  const recommendationResponse = await fetch(`${baseUrl}/api/growing/recommendations?locationId=delhi-delhi&month=2&space=balcony&type=vegetable&experience=beginner`);
  const recommendations = await recommendationResponse.json();
  assert.equal(recommendationResponse.status, 200);
  assert.equal(recommendations.selection.region.slug, 'north-plains');
  assert.ok(recommendations.total_count > 0);

  const invalidResponse = await fetch(`${baseUrl}/api/growing/recommendations?region=north-plains&month=13&space=balcony&type=vegetable&experience=beginner`);
  assert.equal(invalidResponse.status, 422);

  const protectedResponse = await fetch(`${baseUrl}/api/growing/plans`);
  assert.equal(protectedResponse.status, 401);
});
