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
