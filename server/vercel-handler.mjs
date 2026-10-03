const VISITOR = 'public-visitor@deployment.invalid';
function allowedOrigins(env) {
  const origins = [];
  // Trust deployment settings, never caller-supplied Host/forwarded headers.
  for (const value of [env.SITE_ORIGIN, env.VERCEL_URL && `https://${env.VERCEL_URL}`, env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) origins.push(url.origin);
    } catch { /* Invalid deployment origins are not accepted. */ }
  }
  return origins;
}
function json(value, status) {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
  } });
}
export function createVercelHandler(worker) {
  return async function handle(request, env = {}) {
    const url = new URL(request.url);
    if (!allowedOrigins(env).includes(url.origin)) return json({ error: 'deployment_origin_not_configured' }, 503);
    if (!['GET', 'HEAD'].includes(request.method) && (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site')) return json({ error: 'origin_denied' }, 403);
    if (['/api/agents','/api/connection'].includes(url.pathname) && request.headers.has('X-OpenRouter-Key')) return json({ error: 'client_key_not_allowed' }, 400);
    const headers = new Headers(request.headers);
    // The Worker is shared with private Sites deployments. This adapter intentionally
    // grants public access and replaces all caller identity headers. No identity is authenticated.
    headers.set('oai-authenticated-user-id', 'public-visitor');
    headers.set('oai-authenticated-user-email', VISITOR);
    const result = await worker.fetch(new Request(request, { headers }), {
      ALLOWED_USER_EMAILS: VISITOR,
      SITE_ORIGIN: url.origin,
      ALLOWED_MODELS: env.ALLOWED_MODELS,
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY
    });
    if (url.pathname === '/api/status' && result.ok && request.method !== 'HEAD') {
      return json({ ...await result.json(), authentication: 'none', serverKeyOnly: true }, 200);
    }
    const outputHeaders = new Headers(result.headers);
    outputHeaders.set('Vercel-CDN-Cache-Control', 'no-store');
    outputHeaders.set('CDN-Cache-Control', 'no-store');
    return new Response(result.body, { status: result.status, headers: outputHeaders });
  };
}
