const db = require('../config/db');

const findByEmail = (email) =>
  db.query('SELECT * FROM users WHERE email = $1', [email]);

const createUser = (name, email, hashedPassword, role = 'user') =>
  db.query(
    'INSERT INTO users (name, email, password, role, email_verified) VALUES ($1, $2, $3, $4, true) RETURNING id, name, email, role, address, email_verified',
    [name, email, hashedPassword, role]
  );

const findById = (id) =>
  db.query('SELECT id, name, email, role, address, email_verified, created_at FROM users WHERE id = $1', [id]);

const updateProfile = (id, { name, address }) =>
  db.query(
    `UPDATE users
     SET name = COALESCE($2, name),
         address = COALESCE($3, address)
     WHERE id = $1
     RETURNING id, name, email, role, address, email_verified, created_at`,
    [id, name || null, address !== undefined ? JSON.stringify(address) : null]
  );

const updatePassword = (email, hashedPassword) =>
  db.query(
    'UPDATE users SET password = $2 WHERE email = $1 RETURNING id, name, email, role, address, email_verified',
    [email, hashedPassword]
  );

const countUsers = () =>
  db.query('SELECT COUNT(*) FROM users');

const getAllUsers = ({ limit, offset }) =>
  db.query(
    `SELECT id, name, email, role, created_at, COUNT(*) OVER() AS total_count
     FROM users
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

module.exports = { findByEmail, createUser, findById, updateProfile, updatePassword, countUsers, getAllUsers };
