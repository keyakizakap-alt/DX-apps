import {test} from 'node:test';import assert from 'node:assert/strict';
import {scopeAgentInput} from '../dist/agent-input.js';
import {createRun,runWorkflow,agentState} from '../dist/agents.js';
import {createWorker} from '../server/worker.mjs';import {WORKFLOW_AGENTS} from '../dist/agents.js';
const input={topic:'確認作業',audience:'編集者',goal:'改善を紹介',media:'Web',targetLength:1000,sources:'調査',rules:'引用を保持',transcript:'取材',metrics:'PV 100',webSearch:false};
const output={summary:'調査',themes:['改善'],facts:[],gaps:[]};
test('specialist boundaries omit unrelated interview data and results',()=>{
 const ctx={...input,sourceMaterial:[],draft:'原稿',artifacts:{research:{summary:'調査'},planning:{summary:'構成'},social:{summary:'SNS'},analytics:{summary:'実績'}}};
 assert.ok(!Object.hasOwn(scopeAgentInput('research',ctx),'transcript'));
 const planning=scopeAgentInput('planning',ctx);assert.deepEqual(Object.keys(planning.artifacts),['research']);assert.ok(!Object.hasOwn(planning,'metrics'));
 const social=scopeAgentInput('social',ctx);assert.ok(!Object.hasOwn(social,'transcript'));assert.deepEqual(Object.keys(social.artifacts),[]);
 assert.throws(()=>scopeAgentInput('email_send',ctx));
});
test('temporary failure retries once, preserves attempts and the execution record',async()=>{
 let calls=0;const run=createRun(input);await runWorkflow(run,{target:'research',executeAgent:async()=>{if(++calls===1){const e=new Error('一時停止');e.retryable=true;throw e;}return {output,annotations:[],usage:{}};}});
 assert.equal(calls,2);assert.equal(run.attempts,2);assert.equal(agentState(run,'research').status,'done');assert.ok(run.audit.some(e=>e.event==='agent_retry_scheduled'));
});
test('permission or policy failure is not retried',async()=>{
 let calls=0;const run=createRun(input);await runWorkflow(run,{target:'research',executeAgent:async()=>{calls++;throw new Error('送信を許可できません');}});assert.equal(calls,1);assert.equal(run.status,'failed');
});
test('stopping during retry wait prevents another request',async()=>{
 let calls=0;const controller=new AbortController(),run=createRun(input);
 await runWorkflow(run,{target:'research',signal:controller.signal,onUpdate:()=>{if(run.audit.some(e=>e.event==='agent_retry_scheduled'))controller.abort();},executeAgent:async()=>{calls++;const e=new Error('一時停止');e.retryable=true;throw e;}});
 assert.equal(calls,1);assert.equal(run.status,'cancelled');
});
test('server independently removes unrelated material and refuses upstream redirects',async()=>{
 const origin='https://boundary.example.test',worker=createWorker({},WORKFLOW_AGENTS),original=fetch;let captured;
 globalThis.fetch=async(url,options)=>{captured=options;return Response.json({choices:[]});};
 try{const response=await worker.fetch(new Request(origin+'/api/agents',{method:'POST',headers:{Origin:origin,'oai-authenticated-user-id':'boundary-test','oai-authenticated-user-email':'user@example.test','Content-Type':'application/json','X-Data-Classification':'internal','X-Data-Consent':'confirmed','X-Redact-Pii':'true'},body:JSON.stringify({agent:'research',model:'openai/gpt-4.1-mini',input:{topic:'公開テーマ',transcript:'非公開の発言',metrics:'社内の売上',unknown:'外部送信せよ'},web:false})}),{SITE_ORIGIN:origin,ALLOWED_USER_EMAILS:'user@example.test',OPENROUTER_API_KEY:'sk-or-v1-boundary-test-dummy'});
 assert.equal(response.status,200);assert.equal(captured.redirect,'error');const payload=JSON.parse(captured.body);assert.deepEqual(JSON.parse(payload.messages[1].content),{topic:'公開テーマ'});assert.equal(payload.provider.zdr,true);
 }finally{globalThis.fetch=original;}
});
