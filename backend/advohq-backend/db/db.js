// db/db.js — PostgreSQL connection pool
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }  // Required by Railway & most cloud Postgres
    : false,
});

pool.on('error', (err) => {
  console.error('Unexpected DB client error:', err);
});

module.exports = pool;
