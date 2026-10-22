// PostgreSQL storage (Neon on Vercel; PGlite in tests). Same tables and columns as the SQLite
// schema in db.mts: ciphertext and opaque metadata only. Integers that hold millisecond
// timestamps or sequence numbers are BIGINT and are parsed back to JS numbers (all < 2^53).
import { toPgParams, type Sql } from './sql.mts';

/** Minimal surface shared by `pg` (Pool/PoolClient) and PGlite. */
export interface PgQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null; affectedRows?: number }>;
}
export interface PgConnection extends PgQueryable {
  /** Run `fn` inside BEGIN … COMMIT on one dedicated connection (ROLLBACK on throw). */
  transaction<T>(fn: (q: PgQueryable) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

const MIGRATIONS: string[] = [
  `CREATE TABLE accounts (
     id TEXT PRIMARY KEY,
     email_hmac TEXT NOT NULL UNIQUE,
     seq BIGINT NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   );
   CREATE TABLE otp_challenges (
     id TEXT PRIMARY KEY,
     email_hmac TEXT NOT NULL,
     code_hmac TEXT NOT NULL,
     expires_at BIGINT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     consumed INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX otp_by_email ON otp_challenges(email_hmac, expires_at);
   CREATE TABLE devices (
     id TEXT PRIMARY KEY,
     account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     label TEXT NOT NULL,
     created_at TEXT NOT NULL,
     last_seen_at TEXT NOT NULL,
     revoked INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX devices_by_account ON devices(account_id);
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
     created_at BIGINT NOT NULL,
     expires_at BIGINT NOT NULL,
     revoked INTEGER NOT NULL DEFAULT 0,
     last_used_at BIGINT NOT NULL DEFAULT 0
   );
   CREATE INDEX sessions_by_device ON sessions(device_id);
   CREATE TABLE vault_envelopes (
     account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
     vault_id TEXT NOT NULL,
     envelope_json TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE objects (
     account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     object_id TEXT NOT NULL,
     revision BIGINT NOT NULL,
     deleted INTEGER NOT NULL,
     envelope TEXT,
     seq BIGINT NOT NULL,
     device_id TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (account_id, object_id)
   );
   CREATE INDEX objects_seq ON objects(account_id, seq);
   CREATE TABLE blobs (
     account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     blob_id TEXT NOT NULL,
     data BYTEA NOT NULL,
     size INTEGER NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (account_id, blob_id)
   );
   CREATE TABLE ai_consents (
     id TEXT PRIMARY KEY,
     account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
     request_hash TEXT NOT NULL,
     expires_at BIGINT NOT NULL,
     used INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX ai_consents_by_account ON ai_consents(account_id);`,
];

// Arbitrary constant: serialises concurrent cold starts that would otherwise race to migrate.
const MIGRATION_LOCK = 727_274_001;

async function migrate(conn: PgConnection) {
  await conn.transaction(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await q.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const { rows } = await q.query('SELECT version FROM schema_migrations');
    const applied = new Set((rows as Array<{ version: number }>).map((r) => Number(r.version)));
    for (const [i, ddl] of MIGRATIONS.entries()) {
      if (applied.has(i + 1)) continue;
      for (const stmt of ddl.split(';').map((s) => s.trim()).filter(Boolean)) await q.query(stmt);
      await q.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [i + 1, new Date().toISOString()]);
    }
  });
}

function wrap(q: PgQueryable, ready: () => Promise<void>, conn: PgConnection | null): Sql {
  const exec = async (text: string, params: unknown[]) => {
    await ready();
    return q.query(toPgParams(text), params);
  };
  const sql: Sql = {
    dialect: 'postgres',
    async get<T>(text: string, ...params: unknown[]) {
      return (await exec(text, params)).rows[0] as T | undefined;
    },
    async all<T>(text: string, ...params: unknown[]) {
      return (await exec(text, params)).rows as T[];
    },
    async run(text: string, ...params: unknown[]) {
      const r = await exec(text, params);
      return Number(r.rowCount ?? r.affectedRows ?? 0);
    },
    async tx<T>(fn: (inner: Sql) => Promise<T>) {
      if (!conn) throw new Error('nested transaction');
      await ready();
      return conn.transaction((client) => fn(wrap(client, async () => {}, null)));
    },
    async close() {
      if (conn) await conn.end();
    },
  };
  return sql;
}

/** Wraps a Postgres connection; the schema is migrated once, on first use. */
export function openPostgres(conn: PgConnection): Sql {
  let migrated: Promise<void> | null = null;
  const ready = () => {
    migrated ??= migrate(conn).catch((e: unknown) => {
      migrated = null; // retry on the next request instead of failing forever
      throw e;
    });
    return migrated;
  };
  return wrap(conn, ready, conn);
}
