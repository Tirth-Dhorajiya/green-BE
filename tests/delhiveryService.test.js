const test = require('node:test');
const assert = require('node:assert/strict');
const delhivery = require('../services/delhiveryService');
const { deriveAggregateStatuses } = require('../models/shippingModel');

test('normalizes common Delhivery scan statuses', () => {
  assert.equal(delhivery.normalizeTrackingStatus('Manifested'), 'manifested');
  assert.equal(delhivery.normalizeTrackingStatus('In Transit'), 'in_transit');
  assert.equal(delhivery.normalizeTrackingStatus('Out for Delivery'), 'out_for_delivery');
  assert.equal(delhivery.normalizeTrackingStatus('Delivered'), 'delivered');
  assert.equal(delhivery.normalizeTrackingStatus('Shipment Cancelled'), 'cancelled');
  assert.equal(delhivery.normalizeTrackingStatus('Undelivered', '', 'Address issue'), 'exception');
});

test('derives order state from multiple package states', () => {
  assert.deepEqual(deriveAggregateStatuses(['manifested', 'manifested']), { shipmentStatus: 'manifested', orderStatus: 'processing' });
  assert.deepEqual(deriveAggregateStatuses(['in_transit', 'manifested']), { shipmentStatus: 'in_transit', orderStatus: 'shipped' });
  assert.deepEqual(deriveAggregateStatuses(['delivered', 'delivered']), { shipmentStatus: 'delivered', orderStatus: 'delivered' });
  assert.deepEqual(deriveAggregateStatuses(['delivered', 'exception']), { shipmentStatus: 'partial', orderStatus: 'shipped' });
  assert.deepEqual(deriveAggregateStatuses(['cancelled', 'cancelled']), { shipmentStatus: 'cancelled', orderStatus: 'cancelled' });
});

test('creates stable event keys for webhook deduplication', () => {
  const event = {
    status: 'In Transit',
    statusCode: 'X-100',
    statusType: 'UD',
    location: 'Delhi Hub',
    occurredAt: '2026-07-20T10:00:00Z',
  };
  assert.equal(delhivery.eventKey(event), delhivery.eventKey({ ...event }));
  assert.notEqual(delhivery.eventKey(event), delhivery.eventKey({ ...event, location: 'Mumbai Hub' }));
});

test('parses Delhivery tracking payloads into packages and scans', () => {
  const records = delhivery.parseTrackingPayload({
    ShipmentData: [{
      Shipment: {
        AWB: '1234567890',
        Status: { Status: 'In Transit', StatusCode: 'X-100', StatusDateTime: '2026-07-20T10:00:00Z' },
        Scans: [{ ScanDetail: { Status: 'Manifested', StatusDateTime: '2026-07-19T10:00:00Z', StatusLocation: 'Warehouse' } }],
      },
    }],
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].waybill, '1234567890');
  assert.equal(records[0].scans[0].status, 'Manifested');
});

test('builds a multi-parcel manifestation payload with explicit AWBs', () => {
  const payload = delhivery.buildManifestPayload({
    config: { clientName: 'Green Store', pickupLocation: 'Main Warehouse' },
    providerReference: 'GRN-ORDER-1',
    ewaybillNumber: '123456789012',
    order: {
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      created_at: '2026-07-20T10:00:00Z',
      total_price: '1200.00',
      user_name: 'Customer',
      shipping_address: { name: 'Customer', phone: '9876543210', address: '1 Green Road', city: 'Pune', state: 'Maharashtra', country: 'India', postalCode: '411001' },
      items: [{ quantity: 2 }],
    },
    packages: [
      { waybill: 'AWB1', contents: 'Plant', weight_grams: 500, length_cm: 20, width_cm: 20, height_cm: 30 },
      { waybill: 'AWB2', contents: 'Planter', weight_grams: 800, length_cm: 25, width_cm: 25, height_cm: 25 },
    ],
  });
  assert.equal(payload.pickup_location.name, 'Main Warehouse');
  assert.equal(payload.shipments.length, 2);
  assert.deepEqual(payload.shipments.map((shipment) => shipment.waybill), ['AWB1', 'AWB2']);
  assert.ok(payload.shipments.every((shipment) => shipment.order === 'GRN-ORDER-1' && shipment.payment_mode === 'Prepaid'));
  assert.ok(payload.shipments.every((shipment) => shipment.ewbn === '123456789012'));
});

test('selects staging and production configuration without exposing credentials', () => {
  const previous = {
    env: process.env.DELHIVERY_ENV,
    token: process.env.DELHIVERY_API_TOKEN,
    client: process.env.DELHIVERY_CLIENT_NAME,
    pickup: process.env.DELHIVERY_PICKUP_LOCATION,
  };
  process.env.DELHIVERY_API_TOKEN = 'test-token';
  process.env.DELHIVERY_CLIENT_NAME = 'Green Store';
  process.env.DELHIVERY_PICKUP_LOCATION = 'Main Warehouse';
  process.env.DELHIVERY_ENV = 'staging';
  assert.match(delhivery.getConfig().baseUrl, /staging-express/);
  process.env.DELHIVERY_ENV = 'production';
  assert.match(delhivery.getConfig().baseUrl, /track\.delhivery/);
  Object.entries(previous).forEach(([key, value]) => {
    const envName = { env: 'DELHIVERY_ENV', token: 'DELHIVERY_API_TOKEN', client: 'DELHIVERY_CLIENT_NAME', pickup: 'DELHIVERY_PICKUP_LOCATION' }[key];
    if (value === undefined) delete process.env[envName];
    else process.env[envName] = value;
  });
});

test('checks prepaid pincode serviceability through the provider response', async () => {
  const previousFetch = global.fetch;
  const previous = {
    env: process.env.DELHIVERY_ENV,
    token: process.env.DELHIVERY_API_TOKEN,
    client: process.env.DELHIVERY_CLIENT_NAME,
    pickup: process.env.DELHIVERY_PICKUP_LOCATION,
  };
  process.env.DELHIVERY_ENV = 'staging';
  process.env.DELHIVERY_API_TOKEN = 'test-token';
  process.env.DELHIVERY_CLIENT_NAME = 'Green Store';
  process.env.DELHIVERY_PICKUP_LOCATION = 'Main Warehouse';
  global.fetch = async () => new Response(JSON.stringify({
    delivery_codes: [{ postal_code: { pin: 411001, city: 'Pune', district: 'Pune', state_code: 'MH', pre_paid: 'Y', remarks: '' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const result = await delhivery.checkServiceability('411001');
    assert.equal(result.serviceable, true);
    assert.equal(result.city, 'Pune');
  } finally {
    global.fetch = previousFetch;
    Object.entries(previous).forEach(([key, value]) => {
      const envName = { env: 'DELHIVERY_ENV', token: 'DELHIVERY_API_TOKEN', client: 'DELHIVERY_CLIENT_NAME', pickup: 'DELHIVERY_PICKUP_LOCATION' }[key];
      if (value === undefined) delete process.env[envName];
      else process.env[envName] = value;
    });
  }
});
