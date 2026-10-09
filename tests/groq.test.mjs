import {test} from 'node:test';import assert from 'node:assert/strict';
import {createWorker} from '../server/worker.mjs';import {createVercelHandler} from '../server/vercel-handler.mjs';import {WORKFLOW_AGENTS} from '../dist/agents.js';
const origin='https://groq.example.test',handle=createVercelHandler(createWorker({},WORKFLOW_AGENTS));
const env={SITE_ORIGIN:origin,ALLOW_PUBLIC_AI:'true',AI_PROVIDER:'groq',GROQ_API_KEY:'gsk_groqTestDummyKey0123456789',GROQ_ZDR_CONFIRMED:'true'};
const post=(path,body)=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Data-Classification':'internal','X-Data-Consent':'confirmed','X-Redact-Pii':'true'},body:body&&JSON.stringify(body)});
const agentBody=(extra={})=>({agent:'writing',model:'openai/gpt-oss-120b',input:{topic:'業務改善',audience:'経営者',goal:'紹介',targetLength:5000},web:false,...extra});
const ok=content=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]});
const withFetch=async(fake,run)=>{const previous=globalThis.fetch;globalThis.fetch=fake;try{return await run();}finally{globalThis.fetch=previous;}};

test('Groq is used only after the operator confirms zero data retention',async()=>{let calls=0;
  await withFetch(async()=>{calls++;return ok({ok:true});},async()=>{const unconfirmed={...env,GROQ_ZDR_CONFIRMED:''};
    const status=await (await handle(new Request(origin+'/api/status'),unconfirmed)).json();assert.equal(status.provider,'Groq');assert.equal(status.configured,false);assert.equal(status.connection,'provider_policy_unavailable');
    assert.equal((await (await handle(post('/api/connection'),unconfirmed)).json()).connection,'provider_policy_unavailable');
    assert.equal((await handle(post('/api/agents',agentBody()),unconfirmed)).status,503);});
  assert.equal(calls,0);});

test('connection check probes Groq with its own request shape and a small output reservation',async()=>{const captured=[];
  await withFetch(async(url,options)=>{captured.push({url,options});return ok({ok:true});},async()=>{
    const data=await (await handle(post('/api/connection'),env)).json();assert.equal(data.connection,'ready');assert.equal(data.configured,true);assert.equal(data.defaultModel,'openai/gpt-oss-120b');
    assert.equal(captured.length,1,'no OpenRouter key lookup');assert.equal(captured[0].url,'https://api.groq.com/openai/v1/chat/completions');
    const probe=JSON.parse(captured[0].options.body);assert.equal(probe.max_tokens,256);assert.equal(probe.reasoning_effort,'low');assert.equal(probe.include_reasoning,false);
    assert.ok(!('provider' in probe)&&!('models' in probe));assert.equal(captured[0].options.headers.Authorization,'Bearer '+env.GROQ_API_KEY);assert.ok(!('X-OpenRouter-Title' in captured[0].options.headers));});});

test('agent requests go to Groq with a capped output, a strict schema, and one wait on a rate limit',async()=>{const captured=[];let first=true;
  await withFetch(async(url,options)=>{captured.push({url,body:JSON.parse(options.body)});if(first){first=false;return new Response(JSON.stringify({error:{message:'Rate limit reached'}}),{status:429,headers:{'retry-after':'1'}});}return ok({summary:'s',title:'t',article:'a'});},async()=>{
    const response=await handle(post('/api/agents',agentBody()),env);assert.equal(response.status,200);
    assert.equal(captured.length,2,'retried once after Retry-After');assert.equal(captured[1].url,'https://api.groq.com/openai/v1/chat/completions');
    const body=captured[1].body;assert.equal(body.model,'openai/gpt-oss-120b');assert.equal(body.max_tokens,4000,'writing budget 8000 capped for the free tier');
    assert.equal(body.response_format.json_schema.strict,true);assert.ok(!('provider' in body)&&!('plugins' in body));});});

test('Groq failures map to plain outcomes and web search is refused rather than silently dropped',async()=>{let reply;
  await withFetch(async()=>reply(),async()=>{
    reply=()=>Response.json({error:{message:'json_validate_failed: Generated JSON does not match the expected schema'}},{status:400});
    let r=await handle(post('/api/agents',agentBody()),env);assert.equal(r.status,502);assert.equal((await r.json()).error,'provider_unavailable');
    reply=()=>Response.json({error:{message:'Request too large for model'}},{status:413});
    r=await handle(post('/api/agents',agentBody()),env);assert.equal(r.status,413);assert.equal((await r.json()).error,'provider_request_too_large');
    reply=()=>{throw new Error('must not call upstream');};
    const publicReq=new Request(origin+'/api/agents',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Data-Classification':'public','X-Data-Consent':'confirmed','X-Redact-Pii':'true'},body:JSON.stringify({...agentBody(),agent:'research',web:true})});
    r=await handle(publicReq,env);assert.equal(r.status,400);assert.equal((await r.json()).error,'search_unavailable');});});

test('OpenRouter stays the default provider when AI_PROVIDER is not groq',async()=>{
  const status=await (await handle(new Request(origin+'/api/status'),{SITE_ORIGIN:origin,ALLOW_PUBLIC_AI:'true',GROQ_API_KEY:env.GROQ_API_KEY,GROQ_ZDR_CONFIRMED:'true'})).json();
  assert.equal(status.provider,'OpenRouter');assert.equal(status.connection,'missing_key');});
