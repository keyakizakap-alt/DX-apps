// Optional local browser check; requires Chromium, Playwright and OpenSSL.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import { createVercelHandler } from '../server/vercel-handler.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/codex/runtimes/cua/lib/node_modules/playwright-core');
const temporary = await mkdtemp(join(tmpdir(), 'angle-vercel-test-'));
const key = join(temporary, 'key.pem'), cert = join(temporary, 'cert.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
const handle = createVercelHandler(worker);
const env = {};
const server = https.createServer({ key: await readFile(key), cert: await readFile(cert) }, async (incoming, outgoing) => {
  try {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const request = new Request(env.SITE_ORIGIN + incoming.url, { method: incoming.method, headers: incoming.headers, body: ['GET','HEAD'].includes(incoming.method) ? undefined : Buffer.concat(chunks) });
    const response = await handle(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = env.SITE_ORIGIN = `https://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const errors = [];

try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.locator('#nav-editor').waitFor();
  assert.equal(await page.locator('input[type=password]').count(), 0);
  await page.locator('#settings-button').click();
  assert.equal(await page.locator('#api-key,#model,#reviewModel,#researchModel').count(), 0);
  assert.equal(await page.locator('#settings-dialog h2').textContent(), '資料の取り扱い');
  await page.locator('[data-close="settings-dialog"]').click();
  await page.locator('#nav-editor').click();
  await page.locator('#run-review').click();
  await page.locator('#result-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#total-count').textContent(), '4');
  const status = await page.request.get(origin + '/api/status');
  assert.equal(status.status(), 200);
  assert.equal((await status.json()).configured, false);
  assert.equal((await context.cookies()).length, 0);
  assert.deepEqual(errors, []);
  console.log('Vercel HTTPS password-free app → no user key input → review: passed');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
