const crypto = require('crypto');

const STAGING_BASE_URL = 'https://staging-express.delhivery.com';
const PRODUCTION_BASE_URL = 'https://track.delhivery.com';

class DelhiveryError extends Error {
  constructor(message, statusCode = 502, details = null) {
    super(message);
    this.name = 'DelhiveryError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const getConfig = () => {
  const token = process.env.DELHIVERY_API_TOKEN;
  const clientName = process.env.DELHIVERY_CLIENT_NAME;
  const pickupLocation = process.env.DELHIVERY_PICKUP_LOCATION;
  const environment = process.env.DELHIVERY_ENV === 'production' ? 'production' : 'staging';

  if (!token || !clientName || !pickupLocation) {
    throw new DelhiveryError('Delhivery credentials are not configured', 503);
  }

  return {
    token,
    clientName,
    pickupLocation,
    environment,
    baseUrl: environment === 'production' ? PRODUCTION_BASE_URL : STAGING_BASE_URL,
  };
};

const parseResponse = async (response) => {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/pdf')) {
    return { contentType, buffer: Buffer.from(await response.arrayBuffer()) };
  }

  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // Delhivery has a few legacy endpoints that return plain text.
  }

  if (!response.ok) {
    const providerMessage = typeof data === 'object'
      ? data.detail || data.message || data.error || data.rmk
      : data;
    throw new DelhiveryError(providerMessage || `Delhivery request failed (${response.status})`, response.status >= 500 ? 502 : 400, data);
  }

  return { contentType, data };
};

const request = async (path, { method = 'GET', query, body, form, includeTokenQuery = false } = {}) => {
  const config = getConfig();
  const url = new URL(path, config.baseUrl);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  if (includeTokenQuery) url.searchParams.set('token', config.token);

  const headers = {
    Accept: 'application/json',
    Authorization: `Token ${config.token}`,
  };
  let requestBody;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    requestBody = new URLSearchParams(form).toString();
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: requestBody,
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new DelhiveryError(error.name === 'TimeoutError' ? 'Delhivery request timed out' : 'Delhivery is temporarily unavailable', 503);
  }
  return parseResponse(response);
};

const normalizePostalCode = (value) => String(value || '').replace(/\D/g, '').slice(0, 6);

const checkServiceability = async (postalCode) => {
  const pin = normalizePostalCode(postalCode);
  if (!/^\d{6}$/.test(pin)) throw new DelhiveryError('Enter a valid 6-digit postal code', 400);

  const { data } = await request('/c/api/pin-codes/json/', { query: { filter_codes: pin } });
  const details = data?.delivery_codes?.[0]?.postal_code;
  const serviceable = Boolean(details && details.pre_paid === 'Y' && String(details.remarks || '').toLowerCase() !== 'embargo');
  return {
    postalCode: pin,
    serviceable,
    city: details?.city || null,
    stateCode: details?.state_code || null,
    district: details?.district || null,
    prepaid: details?.pre_paid === 'Y',
    remarks: details?.remarks || null,
  };
};

const fetchWaybills = async (count) => {
  const config = getConfig();
  const { data } = await request('/waybill/api/bulk/json/', {
    query: { client_name: config.clientName, action: 'next', count },
    includeTokenQuery: true,
  });

  const candidates = Array.isArray(data)
    ? data
    : Array.isArray(data?.waybills)
      ? data.waybills
      : String(data?.waybill || data || '').split(',');
  const waybills = candidates.map((value) => String(value).trim()).filter(Boolean);
  if (waybills.length < count) throw new DelhiveryError('Delhivery did not allocate enough waybills', 502, data);
  return waybills.slice(0, count);
};

const buildManifestPayload = ({ order, packages, providerReference, ewaybillNumber, config }) => {
  const address = order.shipping_address || {};
  const orderDate = new Date(order.created_at || Date.now()).toISOString().replace('T', ' ').slice(0, 19);
  const totalQuantity = (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0) || packages.length;

  const shipments = packages.map((pkg) => ({
    waybill: pkg.waybill,
    order: providerReference,
    order_date: orderDate,
    payment_mode: 'Prepaid',
    name: address.name || order.user_name,
    phone: String(address.phone || '').trim(),
    add: [address.address, address.landmark].filter(Boolean).join(', '),
    city: address.city,
    state: address.state,
    country: address.country || 'India',
    pin: normalizePostalCode(address.postalCode),
    products_desc: pkg.contents,
    quantity: String(totalQuantity),
    total_amount: Number(order.total_price),
    cod_amount: 0,
    weight: String(pkg.weight_grams),
    shipment_length: Number(pkg.length_cm),
    shipment_width: Number(pkg.width_cm),
    shipment_height: Number(pkg.height_cm),
    seller_name: config.clientName,
    seller_inv: order.id.slice(0, 50),
    ...(ewaybillNumber ? { ewbn: ewaybillNumber } : {}),
    ...(process.env.DELHIVERY_SELLER_GST_TIN ? { seller_gst_tin: process.env.DELHIVERY_SELLER_GST_TIN } : {}),
    ...(process.env.DELHIVERY_DEFAULT_HSN_CODE ? { hsn_code: process.env.DELHIVERY_DEFAULT_HSN_CODE } : {}),
  }));

  return {
    pickup_location: { name: config.pickupLocation },
    shipments,
  };
};

const manifestShipments = async ({ order, packages, providerReference, ewaybillNumber }) => {
  const config = getConfig();
  const payload = buildManifestPayload({ order, packages, providerReference, ewaybillNumber, config });
  const { data } = await request('/api/cmu/create.json', {
    method: 'POST',
    form: { format: 'json', data: JSON.stringify(payload) },
  });

  const successful = Array.isArray(data?.packages)
    ? data.packages.filter((pkg) => String(pkg.status || '').toLowerCase() !== 'fail')
    : [];
  if (!data?.success || successful.length !== packages.length) {
    throw new DelhiveryError(data?.rmk || data?.packages?.map((pkg) => pkg.remarks).filter(Boolean).join('; ') || 'Delhivery shipment creation failed', 502, data);
  }
  return data;
};

const getTracking = async ({ waybills, reference }) => {
  const { data } = await request('/api/v1/packages/json/', {
    query: {
      waybill: waybills?.filter(Boolean).join(','),
      ref_ids: reference,
    },
  });
  return data;
};

const getLabel = async (waybill) => request('/api/p/packing_slip', {
  query: { wbns: waybill, pdf: 'True' },
});

const downloadDocument = async (documentUrl) => {
  const config = getConfig();
  const url = new URL(documentUrl);
  const trustedHost = url.hostname.endsWith('delhivery.com') || url.hostname.endsWith('amazonaws.com');
  if (url.protocol !== 'https:' || !trustedHost) throw new DelhiveryError('Invalid Delhivery document URL', 502);
  const response = await fetch(url, {
    headers: { Authorization: `Token ${config.token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new DelhiveryError('Unable to download Delhivery label', 502);
  return {
    contentType: response.headers.get('content-type') || 'application/pdf',
    buffer: Buffer.from(await response.arrayBuffer()),
  };
};

const cancelPackage = async (waybill) => {
  const { data } = await request('/api/p/edit', {
    method: 'POST',
    body: { waybill, cancellation: 'true' },
  });
  if (data?.success === false || data?.error) throw new DelhiveryError(data?.message || data?.rmk || 'Delhivery rejected the cancellation', 409, data);
  return data;
};

const createPickup = async ({ pickupDate, pickupTime, expectedPackageCount }) => {
  const config = getConfig();
  const { data } = await request('/fm/request/new/', {
    method: 'POST',
    body: {
      pickup_date: pickupDate,
      pickup_time: pickupTime,
      pickup_location: config.pickupLocation,
      expected_package_count: expectedPackageCount,
    },
  });
  if (data?.success === false || data?.error) throw new DelhiveryError(data?.message || data?.rmk || 'Delhivery rejected the pickup request', 409, data);
  return data;
};

const normalizeTrackingStatus = (status, statusCode = '', instructions = '') => {
  const value = `${status} ${statusCode} ${instructions}`.toLowerCase();
  if (value.includes('cancel')) return 'cancelled';
  if (value.includes('return') || value.includes('rto') || value.includes('undelivered') || value.includes('exception')) return 'exception';
  if (value.includes('delivered')) return 'delivered';
  if (value.includes('out for delivery') || value.includes('ofd')) return 'out_for_delivery';
  if (value.includes('transit') || value.includes('dispatch') || value.includes('picked') || value.includes('pickup complete')) return 'in_transit';
  return 'manifested';
};

const parseTrackingPayload = (payload) => {
  const shipmentData = payload?.ShipmentData || payload?.shipment_data || [];
  const records = Array.isArray(shipmentData) ? shipmentData : [shipmentData];
  return records.map((record) => record?.Shipment || record).filter(Boolean).map((shipment) => {
    const current = shipment.Status || shipment.status || {};
    const scans = (shipment.Scans || shipment.scans || []).map((scan) => scan.ScanDetail || scan).filter(Boolean);
    return {
      waybill: String(shipment.AWB || shipment.Waybill || shipment.waybill || ''),
      current: {
        status: current.Status || current.status || shipment.Status || 'Manifested',
        statusCode: current.StatusCode || current.status_code || '',
        statusType: current.StatusType || current.ScanType || '',
        location: current.StatusLocation || current.location || '',
        instructions: current.Instructions || '',
        occurredAt: current.StatusDateTime || current.status_datetime || new Date().toISOString(),
        estimatedDeliveryDate: shipment.ExpectedDeliveryDate || shipment.EDD || null,
      },
      scans: scans.map((scan) => ({
        status: scan.Status || scan.status || 'Update',
        statusCode: scan.StatusCode || scan.status_code || '',
        statusType: scan.ScanType || scan.StatusType || '',
        location: scan.StatusLocation || scan.location || '',
        instructions: scan.Instructions || '',
        occurredAt: scan.StatusDateTime || scan.status_datetime || new Date().toISOString(),
        raw: scan,
      })),
      raw: shipment,
    };
  });
};

const parseWebhookPayload = (payload) => {
  const shipment = payload?.Shipment || payload?.shipment || payload;
  const waybill = String(shipment.AWB || shipment.Waybill || shipment.waybill || payload?.waybill || '');
  const detail = shipment.Status || shipment.ScanDetail || shipment.status || payload;
  return {
    waybill,
    status: detail.Status || detail.status || 'Update',
    statusCode: detail.StatusCode || detail.status_code || '',
    statusType: detail.ScanType || detail.StatusType || '',
    location: detail.StatusLocation || detail.location || '',
    instructions: detail.Instructions || detail.instructions || '',
    occurredAt: detail.StatusDateTime || detail.status_datetime || new Date().toISOString(),
    estimatedDeliveryDate: shipment.ExpectedDeliveryDate || shipment.EDD || null,
    raw: payload,
  };
};

const eventKey = (event) => crypto
  .createHash('sha256')
  .update([event.statusCode, event.status, event.statusType, event.location, event.occurredAt].join('|'))
  .digest('hex');

module.exports = {
  DelhiveryError,
  getConfig,
  normalizePostalCode,
  checkServiceability,
  fetchWaybills,
  buildManifestPayload,
  manifestShipments,
  getTracking,
  getLabel,
  downloadDocument,
  cancelPackage,
  createPickup,
  normalizeTrackingStatus,
  parseTrackingPayload,
  parseWebhookPayload,
  eventKey,
};
