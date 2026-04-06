// db/migrate.js — Run once to create all tables
// Usage: node db/migrate.js
require('dotenv').config();
const pool = require('./db');

const schema = `
  -- ── USERS ──────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(120) NOT NULL,
    email       VARCHAR(255) UNIQUE NOT NULL,
    username    VARCHAR(80)  UNIQUE NOT NULL,
    password    TEXT         NOT NULL,
    avatar_url  TEXT,
    created_at  TIMESTAMPTZ  DEFAULT NOW()
  );

  -- ── CASES ───────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS cases (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        VARCHAR(255) NOT NULL,
    client_name  VARCHAR(255),
    case_type    VARCHAR(80),
    status       VARCHAR(50)  DEFAULT 'active',   -- active | closed | pending
    court        VARCHAR(255),
    judge        VARCHAR(255),
    filing_date  DATE,
    notes        TEXT,
    created_at   TIMESTAMPTZ  DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  DEFAULT NOW()
  );

  -- ── FILES ───────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS files (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    case_id      INTEGER      REFERENCES cases(id) ON DELETE SET NULL,
    name         VARCHAR(255) NOT NULL,
    s3_key       TEXT         NOT NULL,   -- S3 object key
    s3_url       TEXT         NOT NULL,   -- Public/presigned URL
    mime_type    VARCHAR(100),
    size_bytes   BIGINT,
    created_at   TIMESTAMPTZ  DEFAULT NOW()
  );

  -- ── SCHEDULE EVENTS ─────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS events (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    case_id      INTEGER      REFERENCES cases(id) ON DELETE SET NULL,
    case_name    VARCHAR(255) NOT NULL,
    event_type   VARCHAR(50)  NOT NULL,  -- hearing | meeting | deadline | filing | other
    event_date   DATE         NOT NULL,
    event_time   TIME,
    location     VARCHAR(255),
    judge        VARCHAR(255),
    notes        TEXT,
    created_at   TIMESTAMPTZ  DEFAULT NOW()
  );

  -- ── FILE ANNOTATIONS / NOTES ─────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS file_notes (
    id           SERIAL PRIMARY KEY,
    file_id      INTEGER      NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    user_id      INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content      TEXT         NOT NULL,
    created_at   TIMESTAMPTZ  DEFAULT NOW()
  );

  -- ── INDEXES ─────────────────────────────────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_cases_user      ON cases(user_id);
  CREATE INDEX IF NOT EXISTS idx_files_user      ON files(user_id);
  CREATE INDEX IF NOT EXISTS idx_files_case      ON files(case_id);
  CREATE INDEX IF NOT EXISTS idx_events_user     ON events(user_id);
  CREATE INDEX IF NOT EXISTS idx_events_date     ON events(event_date);
  CREATE INDEX IF NOT EXISTS idx_file_notes_file ON file_notes(file_id);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running migrations…');
    await client.query(schema);
    console.log('✅  All tables created successfully.');
  } catch (err) {
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
