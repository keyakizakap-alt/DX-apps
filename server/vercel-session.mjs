import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = '__Host-angle_session';
const LIFETIME = 4 * 60 * 60;
const OWNER = 'vercel-owner@deployment.invalid';
const securityHeaders = {
  'Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  'CDN-Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  // Same-origin form navigations need an Origin; external referrers remain suppressed.
  'Referrer-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};
function response(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { ...securityHeaders, ...headers } });
}
function json(error, status) {
  return response(JSON.stringify({ error }), status, { 'Content-Type': 'application/json' });
}
function page(message, status, configured) {
  return response(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ANGLE Review ログイン</title><link rel="stylesheet" href="/login.css"><main><p class="brand">ANGLE REVIEW</p><h1>制作チーム専用ログイン</h1><p>${message}</p>${configured ? '<form method="post" action="/api/session"><label for="password">アクセスパスワード</label><input id="password" name="password" type="password" maxlength="512" autocomplete="current-password" required autofocus><button type="submit">ログイン</button></form>' : '<p>VercelのSettings → Environment Variablesで APP_ACCESS_PASSWORD（20文字以上）と SESSION_SECRET（ランダムな32文字以上）を設定し、Redeployしてください。</p>'}<p class="note">業務資料とAIの操作画面は、ログイン後に利用できます。セッションは4時間で終了します。</p></main></html>`, status, { 'Content-Type': 'text/html; charset=utf-8' });
}
const loginCSS = 'body{margin:0;background:#f3f6f8;color:#172b40;font:16px/1.7 system-ui,sans-serif}main{max-width:480px;margin:10vh auto;padding:40px;background:white;border:1px solid #dce5ea;border-radius:16px}.brand{font-size:12px;font-weight:700;letter-spacing:3px;color:#147b79}h1{font-size:24px}label,input,button{display:block}input{box-sizing:border-box;width:100%;padding:12px;margin:8px 0 20px;border:1px solid #aabbc7;border-radius:8px;font:inherit}button{background:#147b79;color:white;border:0;border-radius:8px;padding:12px 24px;font:inherit;cursor:pointer}.note{font-size:13px;color:#617385}@media(max-width:600px){main{margin:24px 16px;padding:24px}}';
function equal(a, b) {
  const hash = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(a), hash(b));
}
function signingKey(env) {
  // Rotating either secret invalidates every issued session.
  return createHmac('sha256', env.SESSION_SECRET).update(env.APP_ACCESS_PASSWORD).digest();
}
function signature(payload, env) {
  return createHmac('sha256', signingKey(env)).update(payload).digest('base64url');
}
function issueSession(env) {
  const payload = `${Math.floor(Date.now() / 1000) + LIFETIME}.${randomBytes(24).toString('base64url')}`;
  return `${payload}.${signature(payload, env)}`;
}
function validSession(request, env) {
  const token = (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  if (!token || token.length > 200) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || !/^\d{10}$/.test(parts[0]) || !/^[A-Za-z0-9_-]{32}$/.test(parts[1])) return false;
  const expires = Number(parts[0]);
  const now = Math.floor(Date.now() / 1000);
  if (expires <= now || expires > now + LIFETIME) return false;
  return equal(parts[2], signature(parts.slice(0, 2).join('.'), env));
}
function allowedOrigins(env) {
  const origins = [];
  // Only deployment configuration determines trusted origins; never Host or forwarded headers.
  for (const value of [env.SITE_ORIGIN, env.VERCEL_URL && `https://${env.VERCEL_URL}`, env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) origins.push(url.origin);
    } catch { /* Invalid configuration fails closed. */ }
  }
  return origins;
}
async function readLoginBody(request) {
  if (Number(request.headers.get('Content-Length')) > 4096) return null;
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); return null; }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createVercelHandler(worker) {
  // Bounded per-instance throttle; configure Vercel Firewall for distributed protection.
  let windowStart = 0, loginAttempts = 0;
  return async function handle(request, env = {}) {
    const url = new URL(request.url);
    if (!allowedOrigins(env).includes(url.origin)) return json('deployment_origin_not_configured', 503);
    if (url.pathname === '/login.css' && ['GET', 'HEAD'].includes(request.method)) {
      return response(request.method === 'HEAD' ? null : loginCSS, 200, { 'Content-Type': 'text/css; charset=utf-8' });
    }
    const configured = typeof env.APP_ACCESS_PASSWORD === 'string' && env.APP_ACCESS_PASSWORD.length >= 20 && env.APP_ACCESS_PASSWORD.length <= 512 && typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= 32;
    if (!configured) return url.pathname.startsWith('/api/') ? json('access_secrets_not_configured', 503) : page('初期設定が必要です。', 503, false);
    const sameOrigin = request.headers.get('Origin') === url.origin && request.headers.get('Sec-Fetch-Site') !== 'cross-site';
    if (url.pathname === '/api/session' && request.method === 'POST') {
      if (!sameOrigin) return json('origin_denied', 403);
      if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return json('form_required', 415);
      if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); loginAttempts = 0; }
      if (++loginAttempts > 10) return response('ログイン試行が多すぎます。1分後に再試行してください。', 429, { 'Retry-After': '60' });
      const body = await readLoginBody(request);
      if (body === null) return json('input_too_large', 413);
      const password = new URLSearchParams(body).get('password') || '';
      if (!equal(password, env.APP_ACCESS_PASSWORD)) return page('パスワードが一致しません。', 401, true);
      return response(null, 303, { Location: '/', 'Set-Cookie': `${COOKIE}=${issueSession(env)}; Path=/; Max-Age=${LIFETIME}; HttpOnly; Secure; SameSite=Strict` });
    }
    if (!validSession(request, env)) {
      if (url.pathname.startsWith('/api/') || !['/', '/index.html', '/login'].includes(url.pathname)) return json('authentication_required', 401);
      return page('専用のアクセスパスワードを入力してください。', 200, true);
    }
    if (url.pathname === '/api/logout') {
      if (request.method !== 'POST') return json('method_not_allowed', 405);
      if (!sameOrigin) return json('origin_denied', 403);
      return response(null, 303, { Location: '/', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` });
    }
    if (url.pathname === '/api/session' || url.pathname === '/login') return response(null, 303, { Location: '/' });
    if (!['GET', 'HEAD'].includes(request.method) && !sameOrigin) return json('origin_denied', 403);
    const headers = new Headers(request.headers);
    // Never accept a caller's platform identity. Identity is supplied only after session verification.
    headers.set('oai-authenticated-user-id', 'vercel-owner');
    headers.set('oai-authenticated-user-email', OWNER);
    const authenticated = new Request(request, { headers });
    const result = await worker.fetch(authenticated, {
      ALLOWED_USER_EMAILS: OWNER,
      SITE_ORIGIN: url.origin,
      ALLOWED_MODELS: env.ALLOWED_MODELS,
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY
    });
    if (url.pathname === '/api/status' && result.ok && request.method !== 'HEAD') {
      return response(JSON.stringify({ ...await result.json(), authentication: 'password' }), 200, { 'Content-Type': 'application/json' });
    }
    const outputHeaders = new Headers(result.headers);
    outputHeaders.set('Referrer-Policy', 'same-origin');
    outputHeaders.set('Vercel-CDN-Cache-Control', 'no-store');
    outputHeaders.set('CDN-Cache-Control', 'no-store');
    return new Response(result.body, { status: result.status, headers: outputHeaders });
  };
}
