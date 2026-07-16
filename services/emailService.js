const nodemailer = require('nodemailer');

const hasSmtpConfig = () =>
  process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS;

const createTransport = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendOtpEmail = async ({ to, otp, purpose }) => {
  const subject = purpose === 'password_reset' ? 'Reset your Green Store password' : 'Verify your Green Store email';
  const text = `Your Green Store OTP is ${otp}. It expires in 10 minutes.`;

  if (!hasSmtpConfig()) {
    console.log(`[DEV OTP] ${purpose} for ${to}: ${otp}`);
    return { delivered: false, devOtp: otp };
  }

  await createTransport().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
  });

  return { delivered: true };
};

const sendContactEmail = async ({ name, email, topic, message }) => {
  const subject = `Green Store contact: ${topic}`;
  const text = [
    `Name: ${name}`,
    `Email: ${email}`,
    `Topic: ${topic}`,
    '',
    message,
  ].join('\n');

  if (!hasSmtpConfig()) {
    console.log(`[DEV CONTACT]\n${text}`);
    return { delivered: false };
  }

  await createTransport().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: process.env.CONTACT_TO || process.env.SMTP_FROM || process.env.SMTP_USER,
    replyTo: email,
    subject,
    text,
  });

  return { delivered: true };
};

const formatMoney = (value) => `Rs. ${Number(value || 0).toFixed(2)}`;

const orderSubject = ({ order, type }) => {
  const ref = `#${String(order.id).slice(0, 8)}`;
  if (type === 'placed') return `Green Store order ${ref} placed`;
  if (type === 'cancelled') return `Green Store order ${ref} cancelled`;
  if (type === 'refunded') return `Refund updated for Green Store order ${ref}`;
  if (type === 'tracking') return `Tracking updated for Green Store order ${ref}`;
  return `Green Store order ${ref} is now ${order.status}`;
};

const sendOrderEmail = async ({ to, order, type = 'status', note }) => {
  const shipping = order.shipping_address || {};
  const lines = [
    `Hello ${order.user_name || shipping.name || 'Customer'},`,
    '',
    `Order: #${String(order.id).slice(0, 8)}`,
    `Status: ${order.status}`,
    `Payment: ${order.payment_status || 'pending'}`,
    `Total: ${formatMoney(order.total_price)}`,
  ];

  if (order.coupon_code) {
    lines.push(`Coupon: ${order.coupon_code} (-${formatMoney(order.discount_amount)})`);
  }
  if (order.tracking_number || order.courier_name) {
    lines.push(`Courier: ${order.courier_name || '-'}`);
    lines.push(`Tracking number: ${order.tracking_number || '-'}`);
  }
  if (order.estimated_delivery_date) {
    lines.push(`Estimated delivery: ${new Date(order.estimated_delivery_date).toLocaleDateString()}`);
  }
  if (shipping.address || shipping.city || shipping.postalCode) {
    lines.push('');
    lines.push('Shipping address:');
    lines.push([shipping.address, shipping.city, shipping.state, shipping.postalCode, shipping.country].filter(Boolean).join(', '));
  }
  if (note) {
    lines.push('');
    lines.push(`Note: ${note}`);
  }

  lines.push('');
  lines.push('Thank you for shopping with Green Store.');

  const text = lines.join('\n');

  if (!hasSmtpConfig()) {
    console.log(`[DEV ORDER EMAIL] ${to}\n${text}`);
    return { delivered: false };
  }

  await createTransport().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: orderSubject({ order, type }),
    text,
  });

  return { delivered: true };
};

module.exports = { sendOtpEmail, sendContactEmail, sendOrderEmail };
