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

module.exports = { sendOtpEmail, sendContactEmail };
