import {handleReminders} from './reminders.mjs';
import {handleWorkspace,workspaceConfigured,workspaceSession,workspaceProjectRole} from './workspace.mjs';
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
    const reminders=await handleReminders(request,env);if(reminders)return reminders;
    if (!['GET', 'HEAD'].includes(request.method) && (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site')) return json({ error: 'origin_denied' }, 403);
    if (['/api/agents','/api/connection'].includes(url.pathname) && request.headers.has('X-OpenRouter-Key')) return json({ error: 'client_key_not_allowed' }, 400);
    const workspace=await handleWorkspace(request,env);if(workspace)return workspace;
    let session=null;
    if(workspaceConfigured(env)&&['/api/agents','/api/connection'].includes(url.pathname)){try{session=await workspaceSession(request,env);}catch{return json({error:'workspace_unavailable'},503);}}
    if(workspaceConfigured(env)&&['/api/agents','/api/connection'].includes(url.pathname)&&!session)return json({error:'login_required'},401);
    if(session&&url.pathname==='/api/agents'&&request.headers.has('X-Project-Id')){let role;try{role=await workspaceProjectRole(session,env,request.headers.get('X-Project-Id'));}catch{return json({error:'workspace_unavailable'},503);}if(!['owner','editor','approver'].includes(role))return json({error:'permission_denied'},403);}
    const headers = new Headers(request.headers);
    // The Worker is shared with private Sites deployments. This adapter intentionally
    // replaces caller identity headers with verified company identity or the public demo identity.
    headers.set('oai-authenticated-user-id', session?.user.id||'public-visitor');
    headers.set('oai-authenticated-user-email', session?.user.email||VISITOR);
    const result = await worker.fetch(new Request(request, { headers }), {
      ALLOWED_USER_EMAILS: session?.user.email||VISITOR,
      SITE_ORIGIN: url.origin,
      ALLOWED_MODELS: env.ALLOWED_MODELS,
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY
    });
    if (url.pathname === '/api/status' && result.ok && request.method !== 'HEAD') {
      return json({ ...await result.json(), authentication: workspaceConfigured(env)?'company-email':'none', serverKeyOnly: true }, 200);
    }
    const outputHeaders = new Headers(result.headers);
    outputHeaders.set('Vercel-CDN-Cache-Control', 'no-store');
    outputHeaders.set('CDN-Cache-Control', 'no-store');
    return new Response(result.body, { status: result.status, headers: outputHeaders });
  };
}
