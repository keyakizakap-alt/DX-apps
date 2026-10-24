// node-postgres pool for Neon (or any PostgreSQL). TLS is required by the connection string
// (`sslmode=require`); the pooled Neon endpoint is recommended for serverless functions.
import pg from 'pg';
import type { PgConnection } from './pg.mts';

const INT8 = 20;

export function nodePgConnection(connectionString: string): { conn: PgConnection; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // BIGINT columns hold ms timestamps / sequence numbers (< 2^53): return numbers, not strings.
    types: { getTypeParser: ((oid: number, format?: 'text' | 'binary') => (oid === INT8 ? Number : pg.types.getTypeParser(oid, format))) as typeof pg.types.getTypeParser },
  });
  const conn: PgConnection = {
    query: (text, params) => pool.query(text, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: (text, params) => client.query(text, params) });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
  return { conn, pool };
}
