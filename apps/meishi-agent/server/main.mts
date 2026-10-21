// Entry point: `npm run server`. Configuration comes from environment variables only.
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { createAnthropicProvider, type AiProvider } from './ai-provider.mts';
import { createApp, type Mailer } from './app.mts';
import { openDb } from './db.mts';

const env = process.env;
const production = env.NODE_ENV === 'production';
const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? '127.0.0.1';
const dbPath = resolve(env.MEISHI_DB_PATH ?? '.data/meishi-sync.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });

let secret = env.MEISHI_SERVER_SECRET ?? '';
if (secret.length < 32) {
  if (production) throw new Error('MEISHI_SERVER_SECRET (>= 32 chars) is required in production');
  secret = randomBytes(32).toString('hex');
  console.warn('[dev] MEISHI_SERVER_SECRET is not set; using an ephemeral secret (OTP/e-mail hashes reset on restart).');
}

function maskEmail(email: string) {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}

// Development mailer prints the OTP to this terminal. A real mail provider is required for
// production; see docs/USER_ACTIONS.md. No mail service is contacted from this code base.
const devMailer: Mailer = {
  async sendOtp(email, code) {
    console.log(`[dev-mailer] 確認コード ${code} → ${maskEmail(email)}（開発用。本番ではメール送信サービスを設定してください）`);
  },
};
if (production && env.MEISHI_ALLOW_DEV_MAILER !== '1') throw new Error('No production mailer is configured (see docs/USER_ACTIONS.md)');

// External AI is off unless the operator provides a key AND confirms they reviewed the provider's
// data-retention / training terms for their organisation.
let ai: AiProvider | undefined = env.ANTHROPIC_API_KEY && env.MEISHI_AI_TERMS_CONFIRMED === '1' ? createAnthropicProvider(env.ANTHROPIC_API_KEY) : undefined;
if (!ai && env.MEISHI_AI_FAKE === '1') {
  // Test double for E2E: echoes which fields arrived; never contacts any external service.
  if (production) throw new Error('MEISHI_AI_FAKE is not allowed in production');
  ai = {
    destination: 'fake:e2e-echo',
    async generate(req) {
      return { subject: '【テスト】お礼', body: `テスト用の生成結果です。受け取った項目: ${Object.keys(req.fields).sort().join(',')}`, caveats: ['これはE2E用の偽AIの出力です'] };
    },
  };
}

const origins = (env.MEISHI_ALLOWED_ORIGINS ?? `http://localhost:${port},http://127.0.0.1:${port}`).split(',').map((s) => s.trim()).filter(Boolean);
const handler = createApp({
  db: openDb(dbPath),
  secret,
  mailer: devMailer,
  ai,
  staticDir: env.MEISHI_STATIC_DIR ?? resolve('dist'),
  secureCookies: production || env.MEISHI_SECURE_COOKIES === '1',
  allowedOrigins: origins,
});

createServer((req, res) => void handler(req, res)).listen(port, host, () => {
  console.log(`meishi-agent sync server: http://${host}:${port}  (AI: ${ai ? 'enabled' : 'disabled'})`);
});
