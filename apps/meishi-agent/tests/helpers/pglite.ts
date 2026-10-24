// In-process PostgreSQL (PGlite, WASM) for running the server suites against the Postgres schema.
// Starting PGlite takes seconds, so one instance is shared per test file (Vitest worker) and
// emptied between tests instead of being recreated.
import { PGlite } from '@electric-sql/pglite';
import { openPostgres, type PgConnection } from '../../server/pg.mts';
import type { Sql } from '../../server/sql.mts';

let shared: { db: PGlite; sql: Sql } | null = null;

function connect(db: PGlite): PgConnection {
  // PGlite is single-connection: serialise transactions like a pool with one client would.
  let queue: Promise<unknown> = Promise.resolve();
  return {
    query: (text, params) => db.query(text, params),
    transaction(fn) {
      const next = queue.then(() => db.transaction((tx) => fn({ query: (text, params) => tx.query(text, params) })));
      queue = next.catch(() => undefined);
      return next;
    },
    end: async () => {},
  };
}

export function openPglite(): Sql {
  if (!shared) {
    const db = new PGlite({ parsers: { 20: (v: string) => Number(v) } });
    shared = { db, sql: openPostgres(connect(db)) };
  }
  const { db, sql } = shared;
  return {
    ...sql,
    // "Closing" empties every application table so the next test starts from a clean database.
    async close() {
      const { rows } = await db.query<{ name: string }>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations'");
      if (rows.length) await db.exec(`TRUNCATE ${rows.map((r) => `"${r.name}"`).join(', ')} CASCADE`);
    },
  };
}
