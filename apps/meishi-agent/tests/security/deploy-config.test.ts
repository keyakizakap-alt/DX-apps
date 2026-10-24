// Production wiring: fail-closed settings, the Resend mailer, and the bundled Vercel function.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { settingsFromEnv } from '../../server/config.mts';
import { MailError, otpMessage, resendMailer } from '../../server/mailer.mts';
import { bundleFunction, outputConfig } from '../../scripts/vercel-output.mjs';

const SECRET = 's'.repeat(40);

/** fetch() cannot set Host, so the Host-allowlist checks use node:http directly. */
function get(base: string, path: string, host: string): Promise<{ status: number; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const u = new URL(path, base);
    const req = request({ hostname: u.hostname, port: u.port, path: u.pathname, headers: { host } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}
const PROD = { NODE_ENV: 'production', MEISHI_SERVER_SECRET: SECRET, RESEND_API_KEY: 're_test_dummy', MEISHI_MAIL_FROM: 'no-reply@mail.example.test', MEISHI_ALLOWED_ORIGINS: 'https://meishi.example.test' };

describe('settings are fail-closed in production', () => {
  it.each([
    ['secret missing', { MEISHI_SERVER_SECRET: undefined }, /MEISHI_SERVER_SECRET/],
    ['no mailer', { RESEND_API_KEY: undefined }, /mailer/],
    ['mail sender missing', { MEISHI_MAIL_FROM: undefined }, /MEISHI_MAIL_FROM/],
    ['no origins', { MEISHI_ALLOWED_ORIGINS: undefined }, /MEISHI_ALLOWED_ORIGINS/],
    ['http origin', { MEISHI_ALLOWED_ORIGINS: 'http://meishi.example.test' }, /https/],
    ['origin with a path', { MEISHI_ALLOWED_ORIGINS: 'https://meishi.example.test/app' }, /bare origin/],
  ])('%s → refuses to start', (_name, override, message) => {
    expect(() => settingsFromEnv({ ...PROD, ...override }, { origins: [] }), `本番で「${_name}」のまま起動できた。直し方: settingsFromEnv で例外にする`).toThrow(message);
  });
  it('complete production settings → Resend mailer, hosts from origins, AI off without consent flags', () => {
    const s = settingsFromEnv(PROD, { origins: [] });
    expect(s.mailerKind).toBe('resend');
    expect(s.allowedHosts).toEqual(['meishi.example.test']);
    expect(s.ai).toBeUndefined();
  });
});

describe('Resend mailer', () => {
  it('posts only the code e-mail to the Resend API with an idempotency key', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const mailer = resendMailer({ apiKey: 're_test_dummy', from: 'no-reply@mail.example.test', fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"id":"x"}', { status: 200 });
    }) as typeof fetch });
    await mailer.sendOtp('user@example.test', '123456', 'ch_' + 'a'.repeat(24));
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer re_test_dummy');
    expect(headers['idempotency-key']).toBe('ch_' + 'a'.repeat(24));
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body).sort(), 'メール本文に余計な項目が含まれた。直し方: from/to/subject/text だけを送る').toEqual(['from', 'subject', 'text', 'to']);
    expect(body.to).toEqual(['user@example.test']);
    expect(body.text).toContain('123456');
  });
  it('raises MailError on a non-2xx response (the API then answers 502 mail_failed)', async () => {
    const mailer = resendMailer({ apiKey: 'k', from: 'f@example.test', fetchImpl: (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch });
    await expect(mailer.sendOtp('u@example.test', '000000')).rejects.toBeInstanceOf(MailError);
  });
  it('the message warns not to share the code and mentions the 10-minute expiry', () => {
    const { subject, text } = otpMessage('654321');
    expect(subject).toContain('654321');
    expect(text).toMatch(/10分/);
    expect(text).toMatch(/伝えないでください/);
  });
});

describe('Vercel build output', () => {
  let dir = '';
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'meishi-vercel-'));
    await bundleFunction(join(dir, 'api.func'));
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('routes: every response gets the CSP; /api/* goes to the function; SPA fallback excludes /api', () => {
    const { routes } = outputConfig() as { routes: { src?: string; dest?: string; headers?: Record<string, string>; handle?: string }[] };
    const page = routes.find((r) => r.src === '^/(?!ocr/|pdfjs/).*$')!;
    expect(page.headers!['content-security-policy']).toContain("require-trusted-types-for 'script'");
    expect(page.headers!['strict-transport-security']).toMatch(/max-age=31536000/);
    const worker = routes.find((r) => r.src === '^/(?:ocr|pdfjs)/.*$')!;
    expect(worker.headers!['content-security-policy']).not.toContain('require-trusted-types-for');
    expect(routes.find((r) => r.dest === '/api')!.src).toBe('^/api(?:/.*)?$');
    const fallback = routes.at(-1)!;
    expect(new RegExp(fallback.src!).test('/api/me'), 'SPAの代替ルートが /api を飲み込んだ').toBe(false);
    expect(new RegExp(fallback.src!).test('/people/c_1')).toBe(true);
  });

  it('function config is a Node.js handler without request helpers', () => {
    const cfg = JSON.parse(readFileSync(join(dir, 'api.func/.vc-config.json'), 'utf8'));
    expect(cfg).toMatchObject({ handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false });
  });

  it('the bundle starts fail-closed without configuration and serves the API once configured', async () => {
    const saved = { ...process.env };
    const serve = async (env: Record<string, string | undefined>, tag: string) => {
      for (const k of ['DATABASE_URL', 'POSTGRES_URL', 'MEISHI_SERVER_SECRET', 'RESEND_API_KEY', 'MEISHI_MAIL_FROM', 'MEISHI_ALLOWED_ORIGINS']) delete process.env[k];
      Object.assign(process.env, env);
      const mod = await import(`${pathToFileURL(join(dir, 'api.func/index.mjs')).href}?${tag}`);
      const server = createServer((req, res) => void mod.default(req, res));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
    };
    try {
      const bare = await serve({}, 'bare');
      const r1 = await fetch(`${bare.base}/api/health`);
      expect(r1.status, '設定なしで起動してしまった。直し方: vercel.mts で設定不備を 503 にする').toBe(503);
      expect((await r1.json()).error).toBe('server_misconfigured');
      await bare.close();

      // Unreachable database: /api/health and the auth check do not touch it.
      const ok = await serve({ ...PROD, NODE_ENV: undefined, DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db?sslmode=disable' }, 'ok');
      const host = 'meishi.example.test';
      const r2 = await get(ok.base, '/api/health', host);
      expect(r2.status, `バンドルしたAPIが ${r2.status} を返した。直し方: esbuild の出力と vercel.mts の初期化を確認する`).toBe(200);
      expect(String(r2.headers['content-security-policy'])).toContain("default-src 'self'");
      expect((await get(ok.base, '/api/me', host)).status).toBe(401);
      expect((await get(ok.base, '/api/health', 'evil.example.test')).status, 'Host 許可リストが効いていない').toBe(421);
      await ok.close();
    } finally {
      process.env = saved;
    }
  }, 30_000);
});
