// Vercel Function entry (bundled by scripts/build-vercel.mjs into .vercel/output/functions/api.func).
// Static files are served by Vercel's CDN with the same security headers (config.json routes);
// this function serves /api/* only. Storage: Neon PostgreSQL via DATABASE_URL.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { attachDatabasePool } from '@vercel/functions';
import { createApp } from './app.mts';
import { settingsFromEnv } from './config.mts';
import { openPostgres } from './pg.mts';
import { nodePgConnection } from './pg-node.mts';

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

function build(): Handler {
  const env = process.env;
  const url = env.DATABASE_URL ?? env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL is not set (install Neon from the Vercel Marketplace)');
  // Always production rules on Vercel (secret, real mailer, https origins), whatever NODE_ENV says.
  const settings = settingsFromEnv({ ...env, NODE_ENV: 'production', MEISHI_ALLOW_DEV_MAILER: undefined }, { origins: [] });
  const { conn, pool } = nodePgConnection(url);
  attachDatabasePool(pool); // release idle connections before the instance suspends (Fluid compute)
  return createApp({
    sql: openPostgres(conn),
    secret: settings.secret,
    mailer: settings.mailer,
    ai: settings.ai,
    secureCookies: true,
    allowedOrigins: settings.allowedOrigins,
    allowedHosts: settings.allowedHosts,
    clientIpHeader: 'x-real-ip', // set by Vercel; client-supplied values are overwritten
  });
}

let handler: Handler | null = null;
let failure: string | null = null;

export default async function vercelHandler(req: IncomingMessage, res: ServerResponse) {
  if (!handler && !failure) {
    try {
      handler = build();
    } catch (e) {
      // Misconfiguration: log the reason (no secrets in these messages) and fail closed.
      failure = e instanceof Error ? e.message : 'configuration error';
      console.error(JSON.stringify({ level: 'error', at: 'startup', error: failure }));
    }
  }
  if (!handler) {
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'server_misconfigured', message: 'サーバーの設定が完了していません。' }));
    return;
  }
  await handler(req, res);
}
