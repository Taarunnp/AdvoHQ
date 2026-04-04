'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'advohq.db'));

// ── Performance & safety pragmas ──────────────────────────────────────────────
db.pragma('journal_mode = WAL');   // Write-Ahead Logging for better concurrency
db.pragma('foreign_keys = ON');    // Enforce referential integrity
db.pragma('synchronous = NORMAL'); // Balance safety / speed
db.pragma('temp_store = MEMORY');  // Keep temp tables in RAM

// ── Full schema ───────────────────────────────────────────────────────────────
db.exec(`
  -- ─── Users ───────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    email         TEXT    UNIQUE COLLATE NOCASE,
    display_name  TEXT    NOT NULL DEFAULT '',
    password_hash TEXT    NOT NULL,
    totp_secret   TEXT,               -- null until 2FA setup; cleared on disable
    totp_enabled  INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── Refresh-token sessions ───────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT    NOT NULL UNIQUE,   -- SHA-256 of the refresh token
    device_info  TEXT    NOT NULL DEFAULT '',
    ip_address   TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at   TEXT    NOT NULL
  );

  -- ─── Cases ───────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS cases (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT    NOT NULL,
    points     TEXT    NOT NULL DEFAULT '',  -- raw text / bullet notes
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── Case file references (text tags, not actual file uploads) ────────────
  CREATE TABLE IF NOT EXISTS case_files (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id  INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    name     TEXT    NOT NULL,
    added_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── Case important dates ─────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS case_dates (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id  INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    date_iso TEXT    NOT NULL,   -- YYYY-MM-DD
    label    TEXT    NOT NULL,
    notified INTEGER NOT NULL DEFAULT 0,
    added_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── File library items (folders + uploaded files) ────────────────────────
  CREATE TABLE IF NOT EXISTS library_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    type        TEXT    NOT NULL DEFAULT 'txt',  -- folder|pdf|docx|xlsx|pptx|img|txt
    size        TEXT    NOT NULL DEFAULT '0 KB',
    parent_id   INTEGER REFERENCES library_items(id) ON DELETE SET NULL,
    assigned_to TEXT    NOT NULL DEFAULT '',
    next_date   TEXT    NOT NULL DEFAULT '',
    end_date    TEXT    NOT NULL DEFAULT '',
    disk_path   TEXT,                           -- absolute path for uploaded files
    trashed     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── Per-file notes (advohq-file.html notes panel) ───────────────────────
  CREATE TABLE IF NOT EXISTS file_notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_id    INTEGER REFERENCES library_items(id) ON DELETE CASCADE,
    text       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── AI memories ─────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS memories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── Indexes ──────────────────────────────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_sessions_user     ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_hash     ON sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires  ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_cases_user        ON cases(user_id);
  CREATE INDEX IF NOT EXISTS idx_case_files_case   ON case_files(case_id);
  CREATE INDEX IF NOT EXISTS idx_case_dates_case   ON case_dates(case_id);
  CREATE INDEX IF NOT EXISTS idx_library_user      ON library_items(user_id);
  CREATE INDEX IF NOT EXISTS idx_library_parent    ON library_items(parent_id);
  CREATE INDEX IF NOT EXISTS idx_file_notes_user   ON file_notes(user_id);
  CREATE INDEX IF NOT EXISTS idx_file_notes_file   ON file_notes(file_id);
  CREATE INDEX IF NOT EXISTS idx_memories_user     ON memories(user_id);
`);

module.exports = db;
