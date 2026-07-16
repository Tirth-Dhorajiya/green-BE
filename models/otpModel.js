const db = require('../config/db');

const createOtp = ({ email, purpose, otpHash, expiresAt }) =>
  db.query(
    `INSERT INTO email_otps (email, purpose, otp_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, purpose, expires_at`,
    [email, purpose, otpHash, expiresAt]
  );

const findLatest = ({ email, purpose }) =>
  db.query(
    `SELECT *
     FROM email_otps
     WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [email, purpose]
  );

const consume = (id) =>
  db.query('UPDATE email_otps SET consumed_at = NOW() WHERE id = $1', [id]);

module.exports = { createOtp, findLatest, consume };
