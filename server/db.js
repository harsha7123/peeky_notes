const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dir = process.env.PEEKY_DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(path.join(dir, 'peeky.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    pass TEXT NOT NULL, settings TEXT NOT NULL DEFAULT '{}', created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, label TEXT, created INTEGER NOT NULL, last_seen INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'none', buddy TEXT NOT NULL DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0, reminders TEXT NOT NULL DEFAULT '[]', deleted INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL, updated INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  );
  CREATE TABLE IF NOT EXISTS purchases (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, item TEXT NOT NULL,
    ref TEXT, created INTEGER NOT NULL, PRIMARY KEY (user_id, item)
  );
  CREATE TABLE IF NOT EXISTS sheets (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, url TEXT NOT NULL,
    items TEXT NOT NULL DEFAULT '[]', error TEXT, synced INTEGER
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS notes_updated ON notes(user_id, updated);
  CREATE TABLE IF NOT EXISTS device_codes (
    device_code TEXT PRIMARY KEY, user_code TEXT UNIQUE NOT NULL, label TEXT,
    user_id TEXT, created INTEGER NOT NULL
  );
`);

module.exports = db;
