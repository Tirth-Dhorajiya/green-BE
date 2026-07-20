const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const policy = require('../services/returnPolicyService');
const razorpay = require('../services/razorpayRefundService');
const delhivery = require('../services/delhiveryService');

test('allocates an order discount without exceeding the paid line totals', () => {
  const allocated = policy.allocateNetUnitAmounts({
    items: [{ id: 'a', price: 500, quantity: 2 }, { id: 'b', price: 1000, quantity: 1 }],
    subtotal: 2000,
    discount: 200,
  });
  assert.equal(allocated.reduce((sum, item) => sum + item.netLinePaise, 0), 180000);
  assert.equal(policy.refundableAmountForQuantity({ ...allocated[0], quantity: 2, net_line_paise: allocated[0].netLinePaise }, 1), 45000);
});

test('enforces plant damage-only policy and 48-hour window', () => {
  const deliveredAt = new Date('2026-07-20T00:00:00Z');
  const item = { category_snapshot: 'plants', return_policy_snapshot: 'damage_only', return_window_hours_snapshot: 48 };
  assert.equal(policy.evaluateItemEligibility({ item, reason: 'damaged', deliveredAt, now: new Date('2026-07-21T00:00:00Z') }).eligible, true);
  assert.equal(policy.evaluateItemEligibility({ item, reason: 'change_of_mind', deliveredAt, now: new Date('2026-07-21T00:00:00Z') }).eligible, false);
  assert.equal(policy.evaluateItemEligibility({ item, reason: 'damaged', deliveredAt, now: new Date('2026-07-23T00:00:01Z') }).eligible, false);
});

test('requires reverse pickup for wrong items but not missing items or damaged plants', () => {
  const deliveredAt = new Date('2026-07-20T00:00:00Z');
  const plant = { category_snapshot: 'plants', return_policy_snapshot: 'damage_only', return_window_hours_snapshot: 48 };
  const tool = { category_snapshot: 'tools', return_policy_snapshot: 'returnable', return_window_hours_snapshot: 168 };
  assert.equal(policy.evaluateItemEligibility({ item: plant, reason: 'damaged', deliveredAt, now: deliveredAt }).reverseRequired, false);
  assert.equal(policy.evaluateItemEligibility({ item: tool, reason: 'missing', deliveredAt, now: deliveredAt }).reverseRequired, false);
  assert.equal(policy.evaluateItemEligibility({ item: tool, reason: 'wrong_item', deliveredAt, now: deliveredAt }).reverseRequired, true);
});

test('verifies Razorpay refund webhook signatures against the raw body', () => {
  const previous = {
    keyId: process.env.RAZORPAY_KEY_ID,
    secret: process.env.RAZORPAY_KEY_SECRET,
    webhook: process.env.RAZORPAY_WEBHOOK_SECRET,
  };
  process.env.RAZORPAY_KEY_ID = 'rzp_test';
  process.env.RAZORPAY_KEY_SECRET = 'payment-secret';
  process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-secret';
  const raw = Buffer.from('{"event":"refund.processed"}');
  const signature = crypto.createHmac('sha256', 'webhook-secret').update(raw).digest('hex');
  assert.equal(razorpay.verifyWebhook(raw, signature), true);
  assert.equal(razorpay.verifyWebhook(raw, 'bad-signature'), false);
  if (previous.keyId === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = previous.keyId;
  if (previous.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = previous.secret;
  if (previous.webhook === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET; else process.env.RAZORPAY_WEBHOOK_SECRET = previous.webhook;
});

test('builds reverse manifests with pickup payment mode and warehouse registration', () => {
  const payload = delhivery.buildReverseManifestPayload({
    config: { clientName: 'Green Store', pickupLocation: 'Main Warehouse' },
    providerReference: 'RET-1',
    order: { user_name: 'Customer', shipping_address: { name: 'Customer', phone: '9876543210', address: '1 Road', city: 'Pune', state: 'MH', postalCode: '411001' } },
    packages: [{ waybill: 'R-AWB-1', contents: 'Returned planter', weight_grams: 500, length_cm: 20, width_cm: 20, height_cm: 20 }],
  });
  assert.equal(payload.pickup_location.name, 'Main Warehouse');
  assert.equal(payload.shipments[0].payment_mode, 'Pickup');
  assert.equal(payload.shipments[0].waybill, 'R-AWB-1');
});
