import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVercelHandler } from '../server/vercel-session.mjs';
import { createWorker } from '../server/worker.mjs';
import { WORKFLOW_AGENTS } from '../dist/agents.js';

const origin = 'https://example.test';
const env = {
  SITE_ORIGIN: origin,
  APP_ACCESS_PASSWORD: 'test-only-password-for-vercel',
  SESSION_SECRET: 'test-only-signing-secret-32-characters',
  OPENROUTER_API_KEY: 'sk-or-v1-local-dummy'
};
function setup() {
  return createVercelHandler(createWorker({
    '/index.html': { type: 'text/html', content: '<p>private app</p>' },
    '/app.js': { type: 'text/javascript', content: 'privateJS' }
  }, WORKFLOW_AGENTS));
}
function login(password = env.APP_ACCESS_PASSWORD, headers = {}) {
  return new Request(origin + '/api/session', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ password })
  });
}
async function cookie(handle) {
  const response = await handle(login(), env);
  assert.equal(response.status, 303);
  return response.headers.get('Set-Cookie').split(';')[0];
}
test('missing secrets and unknown origins fail closed', async () => {
  const handle = setup();
  assert.equal((await handle(new Request(origin), { SITE_ORIGIN: origin })).status, 503);
  assert.equal((await handle(new Request(origin + '/api/status'), { SITE_ORIGIN: origin })).status, 503);
  assert.equal((await handle(new Request('https://evil.test'), env)).status, 503);
  assert.equal((await handle(new Request(origin), { ...env, SITE_ORIGIN: '' })).status, 503);
});
test('anonymous visitors only get login and cannot spoof identity or retrieve app assets', async () => {
  const handle = setup();
  const response = await handle(new Request(origin), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /アクセスパスワード/);
  for (const path of ['/app.js', '/api/status', '/api/agents', '/dist/server/index.js']) {
    const response = await handle(new Request(origin + path, { headers: { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'vercel-owner@deployment.invalid' } }), env);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});
test('login issues secure cookie and authenticated app preserves headers and egress policies', async () => {
  const handle = setup();
  const signedIn = await handle(login(), env);
  const setCookie = signedIn.headers.get('Set-Cookie');
  for (const attribute of ['__Host-angle_session=', 'Path=/', 'Secure', 'HttpOnly', 'SameSite=Strict']) assert.ok(setCookie.includes(attribute));
  assert.ok(!setCookie.includes(env.APP_ACCESS_PASSWORD));
  assert.ok(!setCookie.includes(env.SESSION_SECRET));
  const session = setCookie.split(';')[0];
  const response = await handle(new Request(origin, { headers: { Cookie: session } }), env);
  assert.equal(await response.text(), '<p>private app</p>');
  assert.match(response.headers.get('Content-Security-Policy'), /connect-src 'self'/);
  assert.equal(response.headers.get('Referrer-Policy'), 'same-origin');
  assert.equal(response.headers.get('Vercel-CDN-Cache-Control'), 'no-store');
  const status = await handle(new Request(origin + '/api/status', { headers: { Cookie: session } }), env);
  assert.equal((await status.json()).configured, true);
  const blocked = await handle(new Request(origin + '/api/agents', { method: 'POST', headers: { Cookie: session, Origin: origin, 'Content-Type': 'application/json', 'X-Data-Classification': 'restricted', 'X-Data-Consent': 'confirmed' }, body: '{}' }), env);
  assert.equal(blocked.status, 403);
});
test('forged sessions and rotating either secret revoke access', async () => {
  const handle = setup();
  const session = await cookie(handle);
  for (const configuration of [{ ...env, SESSION_SECRET: env.SESSION_SECRET + 'rotated' }, { ...env, APP_ACCESS_PASSWORD: env.APP_ACCESS_PASSWORD + 'rotated' }]) {
    assert.equal((await handle(new Request(origin + '/api/status', { headers: { Cookie: session } }), configuration)).status, 401);
  }
  assert.equal((await handle(new Request(origin + '/api/status', { headers: { Cookie: session + 'tampered' } }), env)).status, 401);
});
test('expired sessions cannot access private assets', async () => {
  const handle = setup();
  const session = await cookie(handle);
  const now = Date.now;
  Date.now = () => now() + 4 * 60 * 60 * 1000 + 1000;
  try { assert.equal((await handle(new Request(origin + '/app.js', { headers: { Cookie: session } }), env)).status, 401); }
  finally { Date.now = now; }
});
test('login and logout reject cross-origin requests; logout clears cookie', async () => {
  const handle = setup();
  assert.equal((await handle(login(env.APP_ACCESS_PASSWORD, { Origin: 'https://evil.test' }), env)).status, 403);
  assert.equal((await handle(login(env.APP_ACCESS_PASSWORD, { 'Sec-Fetch-Site': 'cross-site' }), env)).status, 403);
  assert.equal((await handle(login('wrong password'), env)).status, 401);
  const session = await cookie(handle);
  assert.equal((await handle(new Request(origin + '/api/logout', { method: 'GET', headers: { Cookie: session } }), env)).status, 405);
  assert.equal((await handle(new Request(origin + '/api/logout', { method: 'POST', headers: { Cookie: session, Origin: 'https://evil.test' } }), env)).status, 403);
  const loggedOut = await handle(new Request(origin + '/api/logout', { method: 'POST', headers: { Cookie: session, Origin: origin } }), env);
  assert.equal(loggedOut.status, 303);
  assert.match(loggedOut.headers.get('Set-Cookie'), /Max-Age=0/);
});
test('login throttles repeated guesses and rejects oversized bodies', async () => {
  const handle = setup();
  assert.equal((await handle(login('a'.repeat(5000)), env)).status, 413);
  for (let i = 0; i < 9; i++) assert.equal((await handle(login('wrong'), env)).status, 401);
  assert.equal((await handle(login(), env)).status, 429);
});
test('trusted preview deployment host works without accepting caller-supplied hosts', async () => {
  const handle = setup();
  const configuration = { ...env, SITE_ORIGIN: '', VERCEL_URL: 'example.test' };
  assert.equal((await handle(new Request(origin), configuration)).status, 200);
  assert.equal((await handle(new Request('https://evil.test', { headers: { Host: 'example.test', 'X-Forwarded-Host': 'example.test' } }), configuration)).status, 503);
});
