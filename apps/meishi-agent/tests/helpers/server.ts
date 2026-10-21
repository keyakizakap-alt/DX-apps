import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AiProvider } from '../../server/ai-provider.mts';
import { createApp } from '../../server/app.mts';
import { openDb } from '../../server/db.mts';

export interface TestServer {
  baseUrl: string;
  otps: Map<string, string>;
  logs: string[];
  db: ReturnType<typeof openDb>;
  close(): Promise<void>;
}

export async function startTestServer(opts: { ai?: AiProvider; now?: () => number; quota?: { maxObjects?: number; maxBlobBytes?: number }; allowedHosts?: string[]; staticDir?: string } = {}): Promise<TestServer> {
  const otps = new Map<string, string>();
  const logs: string[] = [];
  const db = openDb(':memory:');
  let server: Server;
  const handler = createApp({
    db,
    secret: 'test-secret-test-secret-test-secret-0123',
    mailer: { sendOtp: async (email, code) => void otps.set(email, code) },
    ai: opts.ai,
    secureCookies: false,
    allowedOrigins: ['http://localhost'],
    now: opts.now,
    quota: opts.quota,
    allowedHosts: opts.allowedHosts,
    staticDir: opts.staticDir,
    log: (line) => logs.push(JSON.stringify(line)),
  });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, otps, logs, db, close: () => new Promise((r) => server.close(() => r())) };
}
