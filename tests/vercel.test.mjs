import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVercelHandler } from '../server/vercel-handler.mjs';
import { createWorker } from '../server/worker.mjs';
import { WORKFLOW_AGENTS } from '../dist/agents.js';
const origin='https://example.test';
const env={SITE_ORIGIN:origin,OPENROUTER_API_KEY:'sk-or-v1-server-test-dummy'};
function setup(){return createVercelHandler(createWorker({'/index.html':{type:'text/html',content:'<p>public app</p>'},'/app.js':{type:'text/javascript',content:'publicJS'}},WORKFLOW_AGENTS));}
function api(headers={}){return new Request(origin+'/api/agents',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Data-Classification':'internal','X-Data-Consent':'confirmed','X-Redact-Pii':'true',...headers},body:JSON.stringify({agent:'planning',model:'openai/gpt-4.1-mini',input:{text:'企画資料'},web:false})});}
test('app opens without password or cookie even before operator sets API key',async()=>{
  const handle=setup();const response=await handle(new Request(origin),{SITE_ORIGIN:origin});
  assert.equal(response.status,200);assert.equal(await response.text(),'<p>public app</p>');assert.equal(response.headers.has('Set-Cookie'),false);
  assert.equal((await handle(new Request(origin+'/app.js'),{SITE_ORIGIN:origin})).status,200);
  const status=await handle(new Request(origin+'/api/status'),{SITE_ORIGIN:origin});assert.deepEqual(await status.json(),{configured:false,provider:'OpenRouter',serverPolicy:'zdr-no-training',connection:'missing_key',defaultModel:'openai/gpt-4.1-mini',authentication:'none',serverKeyOnly:true});
});
test('server status exposes only readiness, never the operator secret',async()=>{
  const response=await setup()(new Request(origin+'/api/status'),env);const data=await response.json();assert.equal(data.configured,true);assert.equal(JSON.stringify(data).includes(env.OPENROUTER_API_KEY),false);assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('unknown origins and cross-site mutations remain blocked',async()=>{
  const handle=setup();assert.equal((await handle(new Request('https://evil.test'),env)).status,503);
  assert.equal((await handle(api({Origin:'https://evil.test'}),env)).status,403);
  assert.equal((await handle(api({'Sec-Fetch-Site':'cross-site'}),env)).status,403);
  assert.equal((await handle(api({'X-Data-Classification':'restricted'}),env)).status,403);
});
test('users cannot override server key and no-key deployments cannot use a client key',async()=>{
  const handle=setup();for(const configuration of [env,{SITE_ORIGIN:origin}])assert.equal((await handle(api({'X-OpenRouter-Key':'sk-or-v1-user-test-dummy'}),configuration)).status,400);
  assert.equal((await handle(api(),{SITE_ORIGIN:origin})).status,401);
});
test('gateway uses only operator key and still pins no-training/ZDR policy',async()=>{
  const original=globalThis.fetch;let captured;globalThis.fetch=async(url,options)=>{captured={url,options,payload:JSON.parse(options.body)};return Response.json({choices:[{message:{content:'{}'},finish_reason:'stop'}]});};
  try{
    const response=await setup()(api({'oai-authenticated-user-id':'spoofed','oai-authenticated-user-email':'spoofed@example.test'}),env);
    assert.equal(response.status,200);assert.equal(captured.options.headers.Authorization,'Bearer '+env.OPENROUTER_API_KEY);
    assert.equal(captured.payload.provider.zdr,true);assert.equal(captured.payload.provider.data_collection,'deny');
    assert.equal(JSON.stringify(captured.payload).includes(env.OPENROUTER_API_KEY),false);assert.equal((await response.text()).includes(env.OPENROUTER_API_KEY),false);
  }finally{globalThis.fetch=original;}
});
test('Vercel origin variables support password-free deployment without trusting Host headers',async()=>{
  const handle=setup();const configuration={VERCEL_URL:'example.test'};assert.equal((await handle(new Request(origin),configuration)).status,200);
  assert.equal((await handle(new Request('https://evil.test',{headers:{Host:'example.test','X-Forwarded-Host':'example.test'}}),configuration)).status,503);
});
test('signed-in users can start unsaved articles while existing project roles remain enforced',async()=>{
 const previous=globalThis.fetch;const configuration={...env,SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture',LOGIN_ALLOWED_EMAILS:'owner@company.test'};let forwarded=0;
 globalThis.fetch=async url=>url.endsWith('/auth/v1/user')?Response.json({id:'owner',email:'owner@company.test',email_confirmed_at:'now'}):Response.json([]);
 const handle=createVercelHandler({fetch:async()=>{forwarded++;return Response.json({ok:true});}});
 try{for(const headers of [{},{'X-Project-Id':''}])assert.equal((await handle(api({Cookie:'__Host-angle_access=fixture',...headers}),configuration)).status,200);for(const id of ['invalid','11111111-1111-4111-8111-111111111111'])assert.equal((await handle(api({Cookie:'__Host-angle_access=fixture','X-Project-Id':id}),configuration)).status,403);assert.equal(forwarded,2);}finally{globalThis.fetch=previous;}
});
