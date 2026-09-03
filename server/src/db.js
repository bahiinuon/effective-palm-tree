import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS requests (
  id             TEXT PRIMARY KEY,
  reference      TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'new',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  payment_ref    TEXT,

  tier_id        TEXT NOT NULL,
  add_on_ids     TEXT NOT NULL DEFAULT '[]',
  currency       TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL,
  turnaround_days INTEGER NOT NULL,

  fan_name       TEXT NOT NULL,
  fan_email      TEXT NOT NULL,
  subject        TEXT NOT NULL,
  brief          TEXT NOT NULL,
  occasion       TEXT,
  must_include   TEXT,
  avoid          TEXT,
  mood           TEXT,
  reference_tracks TEXT,
  needed_by      TEXT,
  share_publicly INTEGER NOT NULL DEFAULT 0,

  artist_notes   TEXT,
  delivery_url   TEXT,
  delivered_email_at TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_email ON requests(fan_email);
`;

// Columns added after the first release. SQLite has no "ADD COLUMN IF NOT
// EXISTS", so each one is checked before it is added.
const ADDED_COLUMNS = [['requests', 'delivered_email_at', 'TEXT']];

function migrate(db) {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!existing.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }
}

export function openDatabase(file = process.env.DATABASE_FILE || 'data/requests.db') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
