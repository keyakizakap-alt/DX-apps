import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AiProvider } from '../../server/ai-provider.mts';
import { createApp } from '../../server/app.mts';
import { openSqlite } from '../../server/db.mts';
import type { Dialect, Sql } from '../../server/sql.mts';
import { openPglite } from './pglite';

export interface TestServer {
  baseUrl: string;
  otps: Map<string, string>;
  logs: string[];
  sql: Sql;
  close(): Promise<void>;
}

/**
 * Storage engine for server suites. Default SQLite; `MEISHI_TEST_DB=postgres` runs the same
 * suites against the PostgreSQL schema (PGlite), as the `pg` Vitest project does.
 */
export const TEST_DIALECT: Dialect = process.env.MEISHI_TEST_DB === 'postgres' ? 'postgres' : 'sqlite';

export async function startTestServer(opts: { ai?: AiProvider; now?: () => number; quota?: { maxObjects?: number; maxBlobBytes?: number }; allowedHosts?: string[]; staticDir?: string; clientIpHeader?: string } = {}): Promise<TestServer> {
  const otps = new Map<string, string>();
  const logs: string[] = [];
  const sql = TEST_DIALECT === 'postgres' ? openPglite() : openSqlite(':memory:');
  let server: Server;
  const handler = createApp({
    sql,
    secret: 'test-secret-test-secret-test-secret-0123',
    mailer: { sendOtp: async (email, code) => void otps.set(email, code) },
    ai: opts.ai,
    secureCookies: false,
    allowedOrigins: ['http://localhost'],
    now: opts.now,
    quota: opts.quota,
    allowedHosts: opts.allowedHosts,
    staticDir: opts.staticDir,
    clientIpHeader: opts.clientIpHeader,
    log: (line) => logs.push(JSON.stringify(line)),
  });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    otps,
    logs,
    sql,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((r) => server.close(() => r()));
      await sql.close();
    },
  };
}
