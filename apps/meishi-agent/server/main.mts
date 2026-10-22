// Entry point: `npm run server` (self-hosted Node). Configuration comes from environment variables
// only. Storage: PostgreSQL when DATABASE_URL is set, otherwise a local SQLite file.
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import type { AiProvider } from './ai-provider.mts';
import { createApp } from './app.mts';
import { settingsFromEnv } from './config.mts';
import { openSqlite } from './db.mts';
import { openPostgres } from './pg.mts';
import { nodePgConnection } from './pg-node.mts';
import type { Sql } from './sql.mts';

const env = process.env;
const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? '127.0.0.1';
const settings = settingsFromEnv(env, {
  origins: [`http://localhost:${port}`, `http://127.0.0.1:${port}`],
  extraHosts: [`${host}:${port}`, `localhost:${port}`, `127.0.0.1:${port}`],
});
settings.warnings.forEach((w) => console.warn(w));

let sql: Sql;
if (env.DATABASE_URL) {
  sql = openPostgres(nodePgConnection(env.DATABASE_URL).conn);
} else {
  const dbPath = resolve(env.MEISHI_DB_PATH ?? '.data/meishi-sync.sqlite');
  mkdirSync(dirname(dbPath), { recursive: true });
  sql = openSqlite(dbPath);
}

let ai: AiProvider | undefined = settings.ai;
if (!ai) console.log(`[ai] external AI disabled: ${settings.aiReason}`);
if (!ai && env.MEISHI_AI_FAKE === '1') {
  // Test double for E2E: echoes which fields arrived; never contacts any external service.
  if (settings.production) throw new Error('MEISHI_AI_FAKE is not allowed in production');
  ai = {
    destination: 'fake:e2e-echo',
    info: { provider: 'E2E用の偽AI（外部送信なし）', model: 'echo', cost: '無料', dataPolicy: 'テスト専用。どこにも送信しない', region: 'このサーバー内' },
    async generate(req) {
      return {
        subject: '【テスト】お礼',
        body: `${req.fields.recipientName ?? ''} 様\nテスト用の生成結果です。受け取った項目: ${Object.keys(req.fields).sort().join(',')}`,
        caveats: ['これはE2E用の偽AIの出力です'],
      };
    },
  };
}

const handler = createApp({
  sql,
  secret: settings.secret,
  mailer: settings.mailer,
  ai,
  staticDir: env.MEISHI_STATIC_DIR ?? resolve('dist'),
  secureCookies: settings.production || env.MEISHI_SECURE_COOKIES === '1',
  allowedOrigins: settings.allowedOrigins,
  allowedHosts: settings.allowedHosts,
  // Only behind a reverse proxy that overwrites this header (e.g. MEISHI_CLIENT_IP_HEADER=x-real-ip).
  clientIpHeader: env.MEISHI_CLIENT_IP_HEADER || undefined,
});

const server = createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => void handler(req, res));
// Slow-client (slowloris) limits.
server.headersTimeout = 20_000;
server.requestTimeout = 60_000;
server.keepAliveTimeout = 5_000;
server.listen(port, host, () => {
  console.log(`meishi-agent sync server: http://${host}:${port}  (storage: ${sql.dialect}, mail: ${settings.mailerKind}, AI: ${ai ? 'enabled' : 'disabled'})`);
});
