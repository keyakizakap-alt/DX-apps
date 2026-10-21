// Server-side authentication / CSRF / OTP / headers.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signIn } from '../helpers/device';
import { startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;
let clock = Date.now();
beforeEach(async () => {
  clock = Date.now();
  server = await startTestServer({ now: () => clock });
});
afterEach(async () => server.close());

const post = (path: string, body: unknown, headers: Record<string, string> = { 'x-meishi-client': 'web' }) =>
  fetch(`${server.baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('auth', () => {
  it('rejects unauthenticated API access', async () => {
    const r = await fetch(`${server.baseUrl}/api/sync/pull?cursor=0`);
    expect(r.status).toBe(401);
  });
  it('rejects state-changing requests without the client header or from a foreign Origin (CSRF)', async () => {
    expect((await post('/api/auth/start', { email: 'a@example.test' }, {})).status).toBe(403);
    expect((await post('/api/auth/start', { email: 'a@example.test' }, { 'x-meishi-client': 'web', origin: 'https://evil.example' })).status).toBe(403);
  });
  it('does not reveal whether an account exists', async () => {
    await signIn(server, 'exists@example.test', 'pc');
    const a = await (await post('/api/auth/start', { email: 'exists@example.test' })).json();
    const b = await (await post('/api/auth/start', { email: 'nobody@example.test' })).json();
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });
  it('locks an OTP after 5 wrong attempts and expires it after 10 minutes', async () => {
    const { challengeId } = await (await post('/api/auth/start', { email: 'otp@example.test' })).json();
    for (let i = 0; i < 5; i++) expect((await post('/api/auth/verify', { challengeId, code: '000000', deviceLabel: 'x' })).status).toBe(400);
    const locked = await post('/api/auth/verify', { challengeId, code: server.otps.get('otp@example.test'), deviceLabel: 'x' });
    expect(locked.status).toBe(429);
    const second = await (await post('/api/auth/start', { email: 'otp2@example.test' })).json();
    clock += 11 * 60_000;
    const expired = await post('/api/auth/verify', { challengeId: second.challengeId, code: server.otps.get('otp2@example.test'), deviceLabel: 'x' });
    expect((await expired.json()).error).toBe('otp_expired');
  });
  it('web sign-in sets an HttpOnly SameSite=Strict cookie and does not return the token in JSON', async () => {
    const { challengeId } = await (await post('/api/auth/start', { email: 'web@example.test' })).json();
    const r = await post('/api/auth/verify', { challengeId, code: server.otps.get('web@example.test'), deviceLabel: 'Chrome' });
    const cookie = r.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect((await r.json()).token).toBeUndefined();
  });
  it('revoking a device ends its session', async () => {
    const a = await signIn(server, 'dev@example.test', 'iPhone');
    const b = await signIn(server, 'dev@example.test', 'PC');
    await a.api.revokeDevice(b.deviceId);
    await expect(b.api.me()).rejects.toMatchObject({ status: 401 });
  });
  it('account deletion requires a recent sign-in', async () => {
    const a = await signIn(server, 'del@example.test', 'iPhone');
    clock += 11 * 60_000;
    await expect(a.api.deleteAccount()).rejects.toMatchObject({ status: 403 });
    const fresh = await signIn(server, 'del@example.test', 'iPhone');
    await fresh.api.deleteAccount();
    await expect(fresh.api.me()).rejects.toMatchObject({ status: 401 });
  });
  it('sends security headers including a CSP without unsafe-eval', async () => {
    const r = await fetch(`${server.baseUrl}/api/health`);
    const csp = r.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/'unsafe-eval'/);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it('rejects blobs that are not encrypted envelopes', async () => {
    const a = await signIn(server, 'blob@example.test', 'iPhone');
    await expect(a.api.putBlob('b_' + '1'.repeat(24), new TextEncoder().encode('plain jpeg bytes......................'))).rejects.toMatchObject({ status: 400 });
  });
});

describe('quotas', () => {
  it('rejects pushes and blobs beyond the per-account quota with 413 "quota" and keeps others unaffected', async () => {
    await server.close();
    server = await startTestServer({ quota: { maxObjects: 2, maxBlobBytes: 100 } });
    const a = await signIn(server, 'quota@example.test', 'pc');
    const id = (n: number) => `c_${String(n).padStart(24, '0')}`;
    const env = Buffer.from(new Uint8Array(40)).toString('base64');
    await a.api.push({ deviceId: a.deviceId, changes: [{ objectId: id(1), baseRevision: null, deleted: false, envelope: env }, { objectId: id(2), baseRevision: null, deleted: false, envelope: env }] });
    await expect(a.api.push({ deviceId: a.deviceId, changes: [{ objectId: id(3), baseRevision: null, deleted: false, envelope: env }] })).rejects.toMatchObject({ status: 413, code: 'quota' });
    // Updating an existing object is still allowed at the limit.
    await a.api.push({ deviceId: a.deviceId, changes: [{ objectId: id(1), baseRevision: 1, deleted: false, envelope: env }] });
    const blob = new Uint8Array(80);
    blob[0] = 1;
    blob[1] = 2;
    await a.api.putBlob(`b_${'1'.repeat(24)}`, blob);
    await expect(a.api.putBlob(`b_${'2'.repeat(24)}`, blob)).rejects.toMatchObject({ status: 413 });
  });
});

describe('hardening', () => {
  it('rejects unexpected Host headers (DNS rebinding) when an allowlist is configured', async () => {
    await server.close();
    server = await startTestServer({ allowedHosts: ['meishi.example.invalid'] });
    const r = await fetch(`${server.baseUrl}/api/health`);
    expect(r.status, 'Hostが許可リスト外でも応答した').toBe(421);
  });
  it('sessions expire after 14 days without use even before the absolute lifetime', async () => {
    const a = await signIn(server, 'idle@example.test', 'pc');
    clock += 13 * 24 * 3600 * 1000;
    await a.api.me(); // used → idle timer restarts
    clock += 13 * 24 * 3600 * 1000;
    await a.api.me();
    clock += 15 * 24 * 3600 * 1000;
    await expect(a.api.me()).rejects.toMatchObject({ status: 401 });
  });
  it('caps OTP e-mails per address per 24 hours', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      clock += 61_000; // stay under the per-minute limit
      last = (await post('/api/auth/start', { email: 'cap@example.test' })).status;
    }
    expect(last, '1日の送信上限が効いていない').toBe(429);
  });
  it('does not serve dotfiles or traverse outside the static root', async () => {
    await server.close();
    const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'static-'));
    mkdirSync(join(dir, 'pub'));
    writeFileSync(join(dir, 'pub', 'index.html'), '<!doctype html><title>app</title>');
    writeFileSync(join(dir, 'pub', '.env'), 'SECRET=1');
    writeFileSync(join(dir, 'outside.txt'), 'outside');
    server = await startTestServer({ staticDir: join(dir, 'pub') });
    for (const path of ['/.env', '/%2e%2e/outside.txt', '/..%2Foutside.txt', '/../outside.txt']) {
      const body = await (await fetch(`${server.baseUrl}${path}`)).text();
      expect(body.includes('SECRET') || body.includes('outside'), `${path} で外部ファイルが読めた`).toBe(false);
    }
  });
  it('rejects prototype-pollution style payloads and unknown fields', async () => {
    const a = await signIn(server, 'proto@example.test', 'pc');
    const raw = `{"deviceId":"${a.deviceId}","changes":[],"__proto__":{"admin":true}}`;
    const r = await fetch(`${server.baseUrl}/api/sync/push`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-meishi-client': 'native', authorization: `Bearer ${a.token}` }, body: raw });
    expect(r.status).toBe(400);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });
  it('rejects unusual HTTP methods', async () => {
    const r = await fetch(`${server.baseUrl}/api/health`, { method: 'PATCH' });
    expect(r.status).toBe(405);
  });
  it('document CSP enforces Trusted Types and cross-origin isolation; worker scripts do not get TT', async () => {
    const h = (await fetch(`${server.baseUrl}/api/health`)).headers;
    expect(h.get('content-security-policy')).toContain("require-trusted-types-for 'script'");
    expect(h.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(h.get('cross-origin-opener-policy')).toBe('same-origin');
    const w = (await fetch(`${server.baseUrl}/ocr/worker.min.js`)).headers;
    expect(w.get('content-security-policy')).not.toContain('require-trusted-types-for');
    expect(w.get('content-security-policy')).toContain("default-src 'self'");
  });
});
