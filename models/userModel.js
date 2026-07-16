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

const getAllUsers = ({ limit, offset, search, role, sortBy, order }) => {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (search) {
    conditions.push(`(name ILIKE $${idx} OR email ILIKE $${idx})`);
    values.push(`%${search}%`);
    idx++;
  }
  if (role) {
    conditions.push(`role = $${idx++}`);
    values.push(role);
  }

  const allowedSort = {
    name: 'name',
    email: 'email',
    role: 'role',
    created_at: 'created_at',
  };
  const sortCol = allowedSort[sortBy] || 'created_at';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(limit, offset);
  return db.query(
    `SELECT id, name, email, role, created_at, COUNT(*) OVER() AS total_count
     FROM users
     ${where}
     ORDER BY ${sortCol} ${sortOrder}
     LIMIT $${idx++} OFFSET $${idx++}`,
    values
  );
};

module.exports = { findByEmail, createUser, findById, updateProfile, updatePassword, countUsers, getAllUsers };
