const crypto = require('crypto');

class RazorpayRefundError extends Error {
  constructor(message, statusCode = 502, details = null) {
    super(message);
    this.name = 'RazorpayRefundError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const getConfig = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new RazorpayRefundError('Razorpay credentials are not configured', 503);
  }
  return {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  };
};

const request = async (path, { method = 'GET', body, idempotencyKey } = {}) => {
  const config = getConfig();
  let response;
  try {
    response = await fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'X-Refund-Idempotency': idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new RazorpayRefundError(error.name === 'TimeoutError' ? 'Razorpay refund request timed out' : 'Razorpay is temporarily unavailable', 503);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerError = data?.error || {};
    throw new RazorpayRefundError(providerError.description || 'Razorpay refund request failed', response.status >= 500 ? 502 : 409, providerError);
  }
  return data;
};

const createRefund = ({ paymentId, amountPaise, receipt, idempotencyKey, notes }) => request(
  `/payments/${encodeURIComponent(paymentId)}/refund`,
  {
    method: 'POST',
    idempotencyKey,
    body: { amount: amountPaise, speed: 'normal', receipt, notes },
  }
);

const getRefund = (refundId) => request(`/refunds/${encodeURIComponent(refundId)}`);
const getPaymentRefunds = (paymentId) => request(`/payments/${encodeURIComponent(paymentId)}/refunds?count=100`);

const verifyWebhook = (rawBody, signature) => {
  const secret = getConfig().webhookSecret;
  if (!secret || !signature || !rawBody) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const left = Buffer.from(String(signature));
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

module.exports = { RazorpayRefundError, createRefund, getRefund, getPaymentRefunds, verifyWebhook };
