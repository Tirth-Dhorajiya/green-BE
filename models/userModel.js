const db = require('../config/db');

const findByEmail = (email) =>
  db.query('SELECT * FROM users WHERE email = $1', [email]);

const createUser = (name, email, hashedPassword, role = 'user') =>
  db.query(
    'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
    [name, email, hashedPassword, role]
  );

const findById = (id) =>
  db.query('SELECT id, name, email, role, created_at FROM users WHERE id = $1', [id]);

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

module.exports = { findByEmail, createUser, findById, countUsers, getAllUsers };
