import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
import {createVercelHandler} from '../server/vercel-handler.mjs';import {createWorker} from '../server/worker.mjs';import {handleWorkspace} from '../server/workspace.mjs';import {handleReminders} from '../server/reminders.mjs';import {WORKFLOW_AGENTS} from '../dist/agents.js';
const origin='https://example.test',key='sk-or-v1-hardening-test-dummy';
const company={SITE_ORIGIN:origin,OPENROUTER_API_KEY:key,SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture',LOGIN_ALLOWED_EMAILS:'@company.test'};
const api=(path='/api/agents',headers={})=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Data-Classification':'internal','X-Data-Consent':'confirmed','X-Redact-Pii':'true',...headers},body:JSON.stringify({agent:'planning',model:'openai/gpt-4.1-mini',input:{text:'企画資料'},web:false})});
const withFetch=async(fake,run)=>{const previous=globalThis.fetch;globalThis.fetch=fake;try{return await run();}finally{globalThis.fetch=previous;}};

test('without company login the paid AI routes fail closed and never reach the worker or OpenRouter',async()=>{let forwarded=0,upstream=0;const handle=createVercelHandler({fetch:async()=>{forwarded++;return Response.json({ok:true});}});
  await withFetch(async()=>{upstream++;return Response.json({});},async()=>{
    const env={SITE_ORIGIN:origin,OPENROUTER_API_KEY:key};
    const agents=await handle(api(),env);assert.equal(agents.status,503);assert.equal((await agents.json()).error,'login_not_configured');
    const connection=await (await handle(api('/api/connection'),env)).json();assert.equal(connection.connection,'login_not_configured');assert.equal(connection.configured,false);
    assert.equal((await handle(api(),{...env,ALLOW_PUBLIC_AI:'yes'})).status,503,'only the exact value "true" opts into public AI');
  });assert.equal(forwarded,0);assert.equal(upstream,0);});

test('company sessions are required, and the shared Supabase allowance is enforced before any AI call',async()=>{let forwarded=0,quota=true,calls=[];const handle=createVercelHandler({fetch:async()=>{forwarded++;return Response.json({ok:true});}});
  await withFetch(async(url,options)=>{calls.push(url);if(url.endsWith('/auth/v1/user'))return Response.json({id:'u1',email:'editor@company.test',email_confirmed_at:'now'});if(url.endsWith('/rpc/angle_consume_ai')){assert.deepEqual(JSON.parse(options.body),{daily_limit:120,minute_limit:30});return quota==='error'?Response.json({message:'down'},{status:500}):Response.json(quota);}return Response.json([]);},async()=>{
    const env={...company,AI_DAILY_LIMIT:'120'};
    assert.equal((await handle(api(),env)).status,401,'no session cookie');
    assert.equal((await (await handle(api('/api/connection'),env)).json()).connection,'login_required');
    const cookie={Cookie:'__Host-angle_access=fixture'};
    assert.equal((await handle(api('/api/agents',cookie),env)).status,200);assert.equal(forwarded,1);
    quota=false;const limited=await handle(api('/api/agents',cookie),env);assert.equal(limited.status,429);assert.equal((await limited.json()).error,'usage_limit');
    quota='error';assert.equal((await handle(api('/api/agents',cookie),env)).status,503,'quota outages fail closed');
    assert.equal(forwarded,1);
  });});

test('pages refuse framing by any other site',async()=>{const handle=createVercelHandler(createWorker({'/index.html':{type:'text/html',content:'<p>app</p>'}},WORKFLOW_AGENTS));
  const page=await handle(new Request(origin+'/index.html'),{SITE_ORIGIN:origin});assert.equal(page.status,200);
  assert.match(page.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);assert.ok(!/chatgpt|openai/.test(page.headers.get('Content-Security-Policy')));
  assert.equal(page.headers.get('X-Frame-Options'),'DENY');assert.match(page.headers.get('Strict-Transport-Security'),/includeSubDomains/);});

test('login codes lock after five wrong attempts per address, even if the next code is correct',async()=>{let verified=0;const env={...company};
  const verify=(email,code)=>handleWorkspace(new Request(origin+'/api/auth/verify',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,code})}),env);
  await withFetch(async(url,options)=>{verified++;const {token}=JSON.parse(options.body);return token==='111111'?Response.json({access_token:'a',refresh_token:'r',expires_in:3600,user:{id:'u',email:'lock@company.test'}}):Response.json({},{status:401});},async()=>{
    for(let i=0;i<5;i++)assert.equal((await verify('lock@company.test','000000')).status,401);
    assert.equal((await verify('lock@company.test','111111')).status,429);assert.equal(verified,5,'locked attempts never reach Supabase');
    assert.equal((await verify('other@company.test','111111')).status,200,'other addresses are unaffected');
  });});

test('scheduled reminders accept only the exact cron secret',async()=>{const env={CRON_SECRET:'cron-secret-value'};const call=auth=>handleReminders(new Request(origin+'/api/reminders',{headers:auth?{Authorization:auth}:{}}),env);
  for(const auth of [undefined,'Bearer cron-secret-valu','Bearer cron-secret-valuex','cron-secret-value'])assert.equal((await call(auth)).status,403);
  assert.equal((await call('Bearer cron-secret-value')).status,200);});

test('shared AI allowance counts per company user per day and minute, and is not readable or writable directly',async()=>{const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create table auth.sessions(id uuid primary key,user_id uuid);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.uid',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt',true),''),'{}')::jsonb$$;grant usage on schema auth to authenticated;grant execute on function auth.uid(),auth.jwt() to authenticated;`);
  const users={a:'11111111-1111-4111-8111-111111111111',b:'22222222-2222-4222-8222-222222222222',outsider:'33333333-3333-4333-8333-333333333333'},session='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  for(const [name,id] of Object.entries(users))await db.query('insert into auth.users values($1,$2,now())',[id,name==='outsider'?'x@elsewhere.test':name+'@company.test']);
  for(const file of ['workspace.sql','company-access.sql','ai-usage.sql'])await db.exec(await fs.readFile(new URL('../database/'+file,import.meta.url),'utf8'));
  await db.exec("insert into angle_private.allowed_email_rules values ('@company.test')");
  const as=async name=>{await db.exec('reset role');await db.query('delete from auth.sessions');await db.query('insert into auth.sessions values($1,$2)',[session,users[name]]);await db.query("select set_config('request.uid',$1,false),set_config('request.jwt',$2,false)",[users[name],JSON.stringify({session_id:session})]);await db.exec('set role authenticated');};
  const consume=async(daily,minute)=>(await db.query('select public.angle_consume_ai($1,$2) as ok',[daily,minute])).rows[0].ok;
  await as('a');assert.deepEqual([await consume(10,2),await consume(10,2),await consume(10,2)],[true,true,false],'per-minute limit');
  await db.exec('reset role');await db.query("update angle_private.ai_usage set minute=minute-interval '2 minutes'");await as('a');
  assert.equal(await consume(3,5),true);assert.equal(await consume(3,5),false,'daily limit counts across minutes');
  await as('b');assert.equal(await consume(3,5),true,'each user has their own allowance');
  await assert.rejects(db.query('select * from angle_private.ai_usage'));await assert.rejects(db.query("update angle_private.ai_usage set calls=0"));
  await as('outsider');await assert.rejects(consume(10,10),'addresses outside the company cannot consume AI');
  await db.exec('reset role');await db.query('delete from auth.sessions');await db.exec('set role authenticated');await db.query("select set_config('request.uid',$1,false)",[users.a]);await assert.rejects(consume(10,10),'a revoked session cannot consume AI');
}finally{await db.close();}});
