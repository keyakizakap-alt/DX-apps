// Sync server storage on node:sqlite (local / self-hosted / tests). Holds account metadata and
// *ciphertext only*. Columns: opaque ids, revisions, sizes, timestamps. No names, card text,
// phone numbers or keys. The PostgreSQL twin of this schema is in pg.mts.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Sql } from './sql.mts';

const MIGRATIONS: string[] = [
  `CREATE TABLE accounts (
     id TEXT PRIMARY KEY,
     email_hmac TEXT NOT NULL UNIQUE,
     seq INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   );
   CREATE TABLE otp_challenges (
     id TEXT PRIMARY KEY,
     email_hmac TEXT NOT NULL,
     code_hmac TEXT NOT NULL,
     expires_at INTEGER NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     consumed INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE devices (
     id TEXT PRIMARY KEY,
     account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     label TEXT NOT NULL,
     created_at TEXT NOT NULL,
     last_seen_at TEXT NOT NULL,
     revoked INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     revoked INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE vault_envelopes (
     account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
     vault_id TEXT NOT NULL,
     envelope_json TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE objects (
     account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     object_id TEXT NOT NULL,
     revision INTEGER NOT NULL,
     deleted INTEGER NOT NULL,
     envelope TEXT,
     seq INTEGER NOT NULL,
     device_id TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (account_id, object_id)
   );
   CREATE INDEX objects_seq ON objects(account_id, seq);
   CREATE TABLE blobs (
     account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     blob_id TEXT NOT NULL,
     data BLOB NOT NULL,
     size INTEGER NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (account_id, blob_id)
   );
   CREATE TABLE ai_consents (
     id TEXT PRIMARY KEY,
     account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     request_hash TEXT NOT NULL,
     expires_at INTEGER NOT NULL,
     used INTEGER NOT NULL DEFAULT 0
   );`,
  // v2: idle-timeout tracking for sessions, lookup index for OTP rate caps.
  `ALTER TABLE sessions ADD COLUMN last_used_at INTEGER NOT NULL DEFAULT 0;
   CREATE INDEX otp_by_email ON otp_challenges(email_hmac, expires_at);`,
];

function migrate(db: DatabaseSync) {
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set((db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((r) => r.version));
  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1;
    if (applied.has(version)) return;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  });
}

export function openSqlite(path: string): Sql {
  const db = new DatabaseSync(path);
  migrate(db);
  const args = (params: unknown[]) => params as SQLInputValue[];
  // One connection: transactions are serialised so statements of concurrent requests never
  // interleave inside an open transaction.
  let queue: Promise<unknown> = Promise.resolve();
  const base = {
    dialect: 'sqlite' as const,
    async get<T>(text: string, ...params: unknown[]) {
      return db.prepare(text).get(...args(params)) as T | undefined;
    },
    async all<T>(text: string, ...params: unknown[]) {
      return db.prepare(text).all(...args(params)) as T[];
    },
    async run(text: string, ...params: unknown[]) {
      return Number(db.prepare(text).run(...args(params)).changes);
    },
  };
  const sql: Sql = {
    ...base,
    tx<T>(fn: (q: Sql) => Promise<T>): Promise<T> {
      const next = queue.then(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const out = await fn(sql);
          db.exec('COMMIT');
          return out;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      });
      queue = next.catch(() => undefined);
      return next;
    },
    async close() {
      await queue;
      db.close();
    },
  };
  return sql;
}
