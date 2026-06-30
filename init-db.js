const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

async function initDb() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Connecting to database:', process.env.DATABASE_URL);
    await client.connect();
    console.log('Connected.');

    const schemaPath = path.join(__dirname, 'schema', 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    console.log('Executing schema.sql...');
    await client.query(sql);
    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Error initializing database:', err);
  } finally {
    await client.end();
  }
}

initDb();
