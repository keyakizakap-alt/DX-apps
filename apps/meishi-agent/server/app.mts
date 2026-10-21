// HTTP API: account auth (e-mail OTP), owner-scoped ciphertext sync, encrypted blobs, the
// consent-bound AI proxy, and static hosting of the web build with a strict CSP.
// The owner of every query is taken from the authenticated session, never from the request body.
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { z } from 'zod';
import { ExternalDraftRequest, MAX_REQUEST_CHARS, canonicalJson, requestHash } from '../src/core/ai/request.ts';
import { MAX_BLOB_BYTES, MAX_PULL, PushRequest, RecoveryEnvelopeWire } from '../src/core/sync/protocol.ts';
import { AiRefusalError, type AiProvider } from './ai-provider.mts';
import { tx, type Db } from './db.mts';

export interface Mailer {
  sendOtp(email: string, code: string): Promise<void>;
}

export interface AppConfig {
  db: Db;
  secret: string; // HMAC pepper for e-mail and OTP hashes
  mailer: Mailer;
  ai?: AiProvider; // undefined → external AI disabled on this server
  staticDir?: string;
  secureCookies: boolean;
  allowedOrigins: string[]; // exact origins allowed to call the API with cookies
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
}

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const RECENT_AUTH_MS = 10 * 60 * 1000;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const COOKIE = 'mc_session';

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

type Ctx = { req: IncomingMessage; res: ServerResponse; url: URL; ip: string };
type Auth = { accountId: string; deviceId: string; createdAt: number };

export function createApp(cfg: AppConfig) {
  const now = cfg.now ?? Date.now;
  const log = cfg.log ?? ((line) => console.log(JSON.stringify(line)));
  const db = cfg.db;
  const hmac = (v: string) => createHmac('sha256', cfg.secret).update(v).digest('hex');
  const sha = (v: string) => createHash('sha256').update(v).digest('hex');
  const hexId = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`;
  const buckets = new Map<string, { tokens: number; at: number }>();

  function rateLimit(key: string, perMinute: number) {
    const t = now();
    const b = buckets.get(key) ?? { tokens: perMinute, at: t };
    b.tokens = Math.min(perMinute, b.tokens + ((t - b.at) / 60_000) * perMinute);
    b.at = t;
    if (b.tokens < 1) throw new HttpError(429, 'rate_limited', '操作が多すぎます。しばらく待ってから再試行してください。');
    b.tokens -= 1;
    buckets.set(key, b);
    if (buckets.size > 50_000) buckets.clear();
  }

  // ---- helpers -------------------------------------------------------------------------------

  async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) throw new HttpError(413, 'too_large');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > limit) throw new HttpError(413, 'too_large');
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async function json<T>(ctx: Ctx, schema: z.ZodType<T>): Promise<T> {
    if (!String(ctx.req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'json_required');
    let parsed: unknown;
    try {
      parsed = JSON.parse((await readBody(ctx.req, MAX_JSON_BYTES)).toString('utf8'));
    } catch {
      throw new HttpError(400, 'invalid_json');
    }
    const result = schema.safeParse(parsed);
    if (!result.success) throw new HttpError(400, 'invalid_request');
    return result.data;
  }

  function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }

  function cookieHeader(token: string | null) {
    const attrs = [`${COOKIE}=${token ?? ''}`, 'Path=/api', 'HttpOnly', 'SameSite=Strict', token ? `Max-Age=${SESSION_TTL_MS / 1000}` : 'Max-Age=0'];
    if (cfg.secureCookies) attrs.push('Secure');
    return attrs.join('; ');
  }

  /** CSRF defence: custom header (forces CORS preflight, which we never grant) + Origin check. */
  function checkCsrf(ctx: Ctx) {
    if (ctx.req.method === 'GET' || ctx.req.method === 'HEAD') return;
    if (!ctx.req.headers['x-meishi-client']) throw new HttpError(403, 'csrf');
    const origin = ctx.req.headers.origin;
    if (origin && !cfg.allowedOrigins.includes(origin)) throw new HttpError(403, 'origin');
  }

  function authenticate(ctx: Ctx): Auth {
    const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(String(ctx.req.headers.authorization ?? ''))?.[1];
    const cookie = String(ctx.req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim().split('='))
      .find(([k]) => k === COOKIE)?.[1];
    const token = bearer ?? cookie;
    if (!token) throw new HttpError(401, 'unauthorized', 'サインインが必要です');
    const row = db
      .prepare(
        `SELECT s.account_id, s.device_id, s.created_at, s.expires_at, s.revoked, d.revoked AS device_revoked
         FROM sessions s JOIN devices d ON d.id = s.device_id WHERE s.token_hash = ?`,
      )
      .get(sha(token)) as { account_id: string; device_id: string; created_at: number; expires_at: number; revoked: number; device_revoked: number } | undefined;
    if (!row || row.revoked || row.device_revoked || row.expires_at < now()) throw new HttpError(401, 'unauthorized', 'セッションの有効期限が切れました。再度サインインしてください。');
    db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(new Date(now()).toISOString(), row.device_id);
    return { accountId: row.account_id, deviceId: row.device_id, createdAt: row.created_at };
  }

  // ---- routes --------------------------------------------------------------------------------

  const routes: Array<{ method: string; path: RegExp; handler: (ctx: Ctx, m: RegExpExecArray) => Promise<void> }> = [];
  const route = (method: string, path: RegExp, handler: (ctx: Ctx, m: RegExpExecArray) => Promise<void>) => routes.push({ method, path, handler });

  route('GET', /^\/api\/health$/, async (ctx) => send(ctx.res, 200, { ok: true, ai: Boolean(cfg.ai), aiDestination: cfg.ai?.destination ?? null }));

  route('POST', /^\/api\/auth\/start$/, async (ctx) => {
    rateLimit(`otp-ip:${ctx.ip}`, 10);
    const { email } = await json(ctx, z.object({ email: z.email().max(254) }).strict());
    const emailHmac = hmac(email.trim().toLowerCase());
    rateLimit(`otp-email:${emailHmac}`, 3);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const challengeId = hexId('ch');
    db.prepare('INSERT INTO otp_challenges (id, email_hmac, code_hmac, expires_at) VALUES (?, ?, ?, ?)').run(challengeId, emailHmac, hmac(`${challengeId}:${code}`), now() + OTP_TTL_MS);
    try {
      await cfg.mailer.sendOtp(email.trim(), code);
    } catch {
      throw new HttpError(502, 'mail_failed', '確認コードを送信できませんでした。時間をおいて再試行してください。');
    }
    // Same response whether or not the account exists (no account enumeration).
    send(ctx.res, 200, { challengeId, expiresInSec: OTP_TTL_MS / 1000 });
  });

  route('POST', /^\/api\/auth\/verify$/, async (ctx) => {
    rateLimit(`verify-ip:${ctx.ip}`, 20);
    const body = await json(ctx, z.object({ challengeId: z.string().regex(/^ch_[0-9a-f]{24}$/), code: z.string().regex(/^\d{6}$/), deviceLabel: z.string().trim().min(1).max(40) }).strict());
    const ch = db.prepare('SELECT * FROM otp_challenges WHERE id = ?').get(body.challengeId) as
      | { email_hmac: string; code_hmac: string; expires_at: number; attempts: number; consumed: number }
      | undefined;
    if (!ch || ch.consumed) throw new HttpError(400, 'otp_invalid', '確認コードが無効です。もう一度コードを送信してください。');
    if (ch.expires_at < now()) throw new HttpError(400, 'otp_expired', '確認コードの有効期限が切れました。再送信してください。');
    if (ch.attempts >= 5) throw new HttpError(429, 'otp_locked', '試行回数の上限に達しました。新しいコードを送信してください。');
    const expected = Buffer.from(ch.code_hmac, 'hex');
    const actual = Buffer.from(hmac(`${body.challengeId}:${body.code}`), 'hex');
    if (!timingSafeEqual(expected, actual)) {
      db.prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?').run(body.challengeId);
      throw new HttpError(400, 'otp_wrong', '確認コードが違います。');
    }
    const token = randomBytes(32).toString('base64url');
    const result = tx(db, () => {
      db.prepare('UPDATE otp_challenges SET consumed = 1 WHERE id = ?').run(body.challengeId);
      let account = db.prepare('SELECT id FROM accounts WHERE email_hmac = ?').get(ch.email_hmac) as { id: string } | undefined;
      if (!account) {
        account = { id: hexId('a') };
        db.prepare('INSERT INTO accounts (id, email_hmac, created_at) VALUES (?, ?, ?)').run(account.id, ch.email_hmac, new Date(now()).toISOString());
      }
      const deviceId = hexId('d');
      const ts = new Date(now()).toISOString();
      db.prepare('INSERT INTO devices (id, account_id, label, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(deviceId, account.id, body.deviceLabel, ts, ts);
      db.prepare('INSERT INTO sessions (token_hash, account_id, device_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(sha(token), account.id, deviceId, now(), now() + SESSION_TTL_MS);
      const hasVault = Boolean(db.prepare('SELECT 1 FROM vault_envelopes WHERE account_id = ?').get(account.id));
      return { accountId: account.id, deviceId, hasVault };
    });
    const native = ctx.req.headers['x-meishi-client'] === 'native';
    send(ctx.res, 200, { ...result, ...(native ? { token } : {}) }, native ? {} : { 'set-cookie': cookieHeader(token) });
  });

  route('POST', /^\/api\/auth\/logout$/, async (ctx) => {
    const auth = authenticate(ctx);
    db.prepare('UPDATE sessions SET revoked = 1 WHERE device_id = ? AND account_id = ?').run(auth.deviceId, auth.accountId);
    send(ctx.res, 200, { ok: true }, { 'set-cookie': cookieHeader(null) });
  });

  route('GET', /^\/api\/me$/, async (ctx) => {
    const auth = authenticate(ctx);
    const hasVault = Boolean(db.prepare('SELECT 1 FROM vault_envelopes WHERE account_id = ?').get(auth.accountId));
    send(ctx.res, 200, { accountId: auth.accountId, deviceId: auth.deviceId, hasVault });
  });

  route('GET', /^\/api\/devices$/, async (ctx) => {
    const auth = authenticate(ctx);
    const devices = db.prepare('SELECT id, label, created_at AS createdAt, last_seen_at AS lastSeenAt, revoked FROM devices WHERE account_id = ? ORDER BY created_at').all(auth.accountId) as Array<{ id: string; revoked: number }>;
    send(ctx.res, 200, { devices: devices.map((d) => ({ ...d, revoked: Boolean(d.revoked), current: d.id === auth.deviceId })) });
  });

  route('POST', /^\/api\/devices\/(d_[0-9a-f]{24})\/revoke$/, async (ctx, m) => {
    const auth = authenticate(ctx);
    const r = db.prepare('UPDATE devices SET revoked = 1 WHERE id = ? AND account_id = ?').run(m[1]!, auth.accountId);
    if (r.changes === 0) throw new HttpError(404, 'not_found');
    db.prepare('UPDATE sessions SET revoked = 1 WHERE device_id = ? AND account_id = ?').run(m[1]!, auth.accountId);
    send(ctx.res, 200, { ok: true });
  });

  route('GET', /^\/api\/vault$/, async (ctx) => {
    const auth = authenticate(ctx);
    const row = db.prepare('SELECT envelope_json FROM vault_envelopes WHERE account_id = ?').get(auth.accountId) as { envelope_json: string } | undefined;
    if (!row) throw new HttpError(404, 'no_vault');
    send(ctx.res, 200, JSON.parse(row.envelope_json));
  });

  route('PUT', /^\/api\/vault$/, async (ctx) => {
    const auth = authenticate(ctx);
    const env = await json(ctx, RecoveryEnvelopeWire);
    const existing = db.prepare('SELECT vault_id FROM vault_envelopes WHERE account_id = ?').get(auth.accountId) as { vault_id: string } | undefined;
    if (existing && existing.vault_id !== env.vaultId) throw new HttpError(409, 'vault_exists', 'このアカウントには別の保管庫が登録されています。');
    db.prepare('INSERT OR REPLACE INTO vault_envelopes (account_id, vault_id, envelope_json, updated_at) VALUES (?, ?, ?, ?)').run(auth.accountId, env.vaultId, JSON.stringify(env), new Date(now()).toISOString());
    send(ctx.res, 200, { ok: true });
  });

  route('POST', /^\/api\/sync\/push$/, async (ctx) => {
    const auth = authenticate(ctx);
    rateLimit(`push:${auth.accountId}`, 120);
    const body = await json(ctx, PushRequest);
    if (body.deviceId !== auth.deviceId) throw new HttpError(403, 'device_mismatch');
    const ts = new Date(now()).toISOString();
    const results = tx(db, () =>
      body.changes.map((c) => {
        const cur = db.prepare('SELECT revision, deleted, envelope, seq FROM objects WHERE account_id = ? AND object_id = ?').get(auth.accountId, c.objectId) as
          | { revision: number; deleted: number; envelope: string | null; seq: number }
          | undefined;
        if ((cur?.revision ?? null) !== c.baseRevision && !(cur === undefined && c.baseRevision === null)) {
          if (cur) return { objectId: c.objectId, status: 'conflict' as const, current: { objectId: c.objectId, revision: cur.revision, deleted: Boolean(cur.deleted), envelope: cur.envelope, seq: cur.seq } };
          // Base revision given but object no longer exists on the server: treat as new.
        }
        const { seq } = db.prepare('UPDATE accounts SET seq = seq + 1 WHERE id = ? RETURNING seq').get(auth.accountId) as { seq: number };
        const revision = (cur?.revision ?? 0) + 1;
        db.prepare(
          `INSERT INTO objects (account_id, object_id, revision, deleted, envelope, seq, device_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, object_id) DO UPDATE SET revision = excluded.revision, deleted = excluded.deleted, envelope = excluded.envelope, seq = excluded.seq, device_id = excluded.device_id, updated_at = excluded.updated_at`,
        ).run(auth.accountId, c.objectId, revision, c.deleted ? 1 : 0, c.envelope, seq, auth.deviceId, ts);
        return { objectId: c.objectId, status: 'ok' as const, revision, seq };
      }),
    );
    send(ctx.res, 200, { results });
  });

  route('GET', /^\/api\/sync\/pull$/, async (ctx) => {
    const auth = authenticate(ctx);
    rateLimit(`pull:${auth.accountId}`, 240);
    const cursor = Math.max(0, Number.parseInt(ctx.url.searchParams.get('cursor') ?? '0', 10) || 0);
    const limit = Math.min(MAX_PULL, Math.max(1, Number.parseInt(ctx.url.searchParams.get('limit') ?? String(MAX_PULL), 10) || MAX_PULL));
    const rows = db
      .prepare('SELECT object_id AS objectId, revision, deleted, envelope, seq FROM objects WHERE account_id = ? AND seq > ? ORDER BY seq LIMIT ?')
      .all(auth.accountId, cursor, limit + 1) as Array<{ objectId: string; revision: number; deleted: number; envelope: string | null; seq: number }>;
    const page = rows.slice(0, limit);
    send(ctx.res, 200, { changes: page.map((r) => ({ ...r, deleted: Boolean(r.deleted) })), cursor: page.at(-1)?.seq ?? cursor, hasMore: rows.length > limit });
  });

  route('PUT', /^\/api\/blobs\/([a-z]{1,4}_[0-9a-f]{24})$/, async (ctx, m) => {
    const auth = authenticate(ctx);
    rateLimit(`blob:${auth.accountId}`, 300);
    if (ctx.req.headers['content-type'] !== 'application/octet-stream') throw new HttpError(415, 'binary_required');
    const data = await readBody(ctx.req, MAX_BLOB_BYTES);
    if (data.length < 34 || data[0] !== 1 || data[1] !== 2) throw new HttpError(400, 'not_an_encrypted_blob'); // envelope v1, purpose=blob
    db.prepare('INSERT OR IGNORE INTO blobs (account_id, blob_id, data, size, created_at) VALUES (?, ?, ?, ?, ?)').run(auth.accountId, m[1]!, data, data.length, new Date(now()).toISOString());
    send(ctx.res, 200, { ok: true });
  });

  route('GET', /^\/api\/blobs\/([a-z]{1,4}_[0-9a-f]{24})$/, async (ctx, m) => {
    const auth = authenticate(ctx);
    const row = db.prepare('SELECT data FROM blobs WHERE account_id = ? AND blob_id = ?').get(auth.accountId, m[1]!) as { data: Uint8Array } | undefined;
    if (!row) throw new HttpError(404, 'not_found');
    ctx.res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' });
    ctx.res.end(Buffer.from(row.data));
  });

  route('DELETE', /^\/api\/blobs\/([a-z]{1,4}_[0-9a-f]{24})$/, async (ctx, m) => {
    const auth = authenticate(ctx);
    db.prepare('DELETE FROM blobs WHERE account_id = ? AND blob_id = ?').run(auth.accountId, m[1]!);
    send(ctx.res, 200, { ok: true });
  });

  route('DELETE', /^\/api\/account$/, async (ctx) => {
    const auth = authenticate(ctx);
    await json(ctx, z.object({ confirm: z.literal('DELETE') }).strict());
    if (now() - auth.createdAt > RECENT_AUTH_MS) throw new HttpError(403, 'reauth_required', '安全のため、サインインし直してから削除してください。');
    db.prepare('DELETE FROM accounts WHERE id = ?').run(auth.accountId); // cascades to all rows
    send(ctx.res, 200, { ok: true }, { 'set-cookie': cookieHeader(null) });
  });

  // ---- external AI (consent-bound) ------------------------------------------------------------

  route('POST', /^\/api\/ai\/consent$/, async (ctx) => {
    const auth = authenticate(ctx);
    if (!cfg.ai) throw new HttpError(503, 'ai_not_configured', '外部AIはこのサーバーで有効化されていません。');
    const body = await json(ctx, z.object({ requestHash: z.string().regex(/^[0-9a-f]{64}$/), destination: z.string() }).strict());
    if (body.destination !== cfg.ai.destination) throw new HttpError(409, 'destination_changed', '送信先が変わりました。もう一度内容を確認してください。');
    const id = hexId('cg');
    db.prepare('INSERT INTO ai_consents (id, account_id, request_hash, expires_at) VALUES (?, ?, ?, ?)').run(id, auth.accountId, body.requestHash, now() + 5 * 60_000);
    send(ctx.res, 200, { consentId: id, expiresInSec: 300 });
  });

  route('POST', /^\/api\/ai\/draft$/, async (ctx) => {
    const auth = authenticate(ctx);
    rateLimit(`ai:${auth.accountId}`, 10);
    if (!cfg.ai) throw new HttpError(503, 'ai_not_configured');
    const body = await json(ctx, z.object({ consentId: z.string().regex(/^cg_[0-9a-f]{24}$/), request: ExternalDraftRequest }).strict());
    if (canonicalJson(body.request).length > MAX_REQUEST_CHARS) throw new HttpError(413, 'too_large', '送信内容が長すぎます。');
    if (body.request.destination !== cfg.ai.destination) throw new HttpError(409, 'destination_changed');
    const hash = await requestHash(body.request);
    // Atomically consume the consent only if it matches this exact request.
    const consumed = db
      .prepare('UPDATE ai_consents SET used = 1 WHERE id = ? AND account_id = ? AND request_hash = ? AND used = 0 AND expires_at > ? RETURNING id')
      .get(body.consentId, auth.accountId, hash, now());
    if (!consumed) throw new HttpError(403, 'consent_invalid', '承認が無効です（内容の変更・期限切れ・使用済み）。もう一度確認してください。');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60_000);
    try {
      const draft = await cfg.ai.generate(body.request, abort.signal);
      send(ctx.res, 200, { draft, destination: cfg.ai.destination });
    } catch (e) {
      if (e instanceof AiRefusalError) throw new HttpError(422, 'ai_refused', 'AIが生成を辞退しました。ローカルの下書きを利用してください。');
      throw new HttpError(502, 'ai_failed', '外部AIの呼び出しに失敗しました。ローカルの下書きを利用してください。');
    } finally {
      clearTimeout(timer);
    }
  });

  // ---- static web build -----------------------------------------------------------------------

  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.gz': 'application/octet-stream', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json',
  };

  function serveStatic(ctx: Ctx) {
    if (!cfg.staticDir || (ctx.req.method !== 'GET' && ctx.req.method !== 'HEAD')) return false;
    const root = resolve(cfg.staticDir);
    let rel: string;
    try {
      rel = normalize(decodeURIComponent(ctx.url.pathname)).replace(/^(\.\.[/\\])+/, '');
    } catch {
      return false;
    }
    let file = join(root, rel);
    if (!file.startsWith(root + sep) && file !== root) return false;
    if (!existsSync(file) || statSync(file).isDirectory()) {
      const html = `${file}.html`;
      file = existsSync(html) ? html : join(root, 'index.html'); // SPA fallback
      if (!existsSync(file)) return false;
    }
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    ctx.res.writeHead(200, { 'content-type': type, 'cache-control': type.startsWith('text/html') ? 'no-store' : 'public, max-age=3600' });
    if (ctx.req.method === 'HEAD') ctx.res.end();
    else createReadStream(file).pipe(ctx.res);
    return true;
  }

  // ---- dispatcher -----------------------------------------------------------------------------

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const started = now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const ctx: Ctx = { req, res, url, ip: req.socket.remoteAddress ?? 'unknown' };
    for (const [k, v] of Object.entries(securityHeaders(cfg.secureCookies))) res.setHeader(k, v);
    let routeName = 'static';
    try {
      if (url.pathname.startsWith('/api/')) {
        checkCsrf(ctx);
        const match = routes.find((r) => r.method === req.method && r.path.test(url.pathname));
        if (!match) throw new HttpError(404, 'not_found');
        routeName = match.path.source;
        await match.handler(ctx, match.path.exec(url.pathname)!);
      } else if (!serveStatic(ctx)) {
        send(res, 404, { error: 'not_found' });
      }
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, 'server_error', 'サーバーエラーが発生しました');
      if (!(e instanceof HttpError)) log({ level: 'error', route: routeName, error: e instanceof Error ? e.name : 'unknown' });
      if (!res.headersSent) send(res, err.status, { error: err.code, message: err.message });
      else res.end();
    }
    // Structured access log: no bodies, no query strings, no e-mail, no ids of people.
    log({ at: new Date(started).toISOString(), method: req.method, route: routeName, status: res.statusCode, ms: now() - started });
  };
}

export function securityHeaders(https: boolean): Record<string, string> {
  return {
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'", // react-native-web injects <style> elements at runtime
      "img-src 'self' blob: data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; '),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'x-frame-options': 'DENY',
    ...(https ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}

