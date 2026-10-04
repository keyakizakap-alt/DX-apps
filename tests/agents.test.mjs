import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configureAI,discoverServer} from '../dist/provider.js';
import {createRun,runWorkflow,agentState,approveRisk,approvePublication,publicationApproved,makeWordPressHTML,applyEditorialRevision} from '../dist/agents.js';
import {verifyAudit} from '../dist/security.js';
const input={topic:'業務改善',audience:'経営者',goal:'改善方法を伝える',media:'ビジネスメディア',targetLength:500,sources:'業務改善の取材。',rules:'取材にない断定をしない。',transcript:'一部が改善した。',metrics:'',webSearch:false};
function fixture(id,risk=false){
  if(['facts','style','structure','final_check'].includes(id))return {findings:id==='final_check'&&risk?[{category:'文意',severity:'check',title:'不正な根拠',explanation:'根拠がない',quote:'一部が改善した。',source_id:'T999',evidence:'架空',suggestion:''}]:[]};
  if(['writing','rewrite'].includes(id))return {summary:'取材から執筆',title:'改善の仕組み',article:'一部が改善した。'};
  if(id==='research')return {summary:'調査',themes:['改善'],facts:[],gaps:[]};
  if(id==='titles')return {summary:'タイトル',titles:['改善の仕組み'],headings:['背景'],tags:['改善'],categories:['ビジネス']};
  if(id==='social')return {summary:'投稿下書き',posts:[{platform:'X',text:'改善の仕組み ［記事URL］'}]};
  return {summary:'準備しました',content:'人による確認を含む下書きです。',items:['確認項目']};
}
function mock({risk=false,failOnce=''}={}){
  let failed=false;const calls=[];
  return {calls,fetch:async(url,options)=>{
    const body=JSON.parse(options.body);calls.push(body.agent);
    if(body.agent===failOnce&&!failed){failed=true;return Response.json({}, {status:503});}
    return Response.json({model:body.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(fixture(body.agent,risk))}}],usage:{prompt_tokens:10,completion_tokens:20,cost:0.001}});
  }};
}
const setupFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({configured:true});await discoverServer();globalThis.fetch=setupFetch;
configureAI({model:'openai/gpt-4.1-mini',classification:'internal',redact:true,consent:true,enabled:true});
test('full flow pauses for metrics, resumes without rerunning completed agents, and exports approved package',async()=>{
  const original=globalThis.fetch;const api=mock();globalThis.fetch=api.fetch;
  try{
    const run=createRun(input);await runWorkflow(run);
    assert.equal(run.status,'awaiting_metrics');assert.equal(api.calls.length,15); // archive is local
    assert.equal(await publicationApproved(run),false);
    await approvePublication(run,'取材根拠と公開前チェック項目を確認しました');
    assert.equal(await publicationApproved(run),true);
    run.input.metrics='PV100、問い合わせ2件。';await runWorkflow(run);
    assert.equal(run.status,'completed');assert.equal(api.calls.length,16);
    assert.equal(await verifyAudit(run.audit),true);
    agentState(run,'social').output.posts[0].text='変更';assert.equal(await publicationApproved(run),false);
  }finally{globalThis.fetch=original;}
});
test('missing transcript stops after preparation without inventing an interview',async()=>{
  const original=globalThis.fetch;const api=mock();globalThis.fetch=api.fetch;
  try{const run=createRun({...input,transcript:''});await runWorkflow(run);assert.equal(run.status,'awaiting_transcript');assert.equal(api.calls.length,4);assert.equal(agentState(run,'writing').status,'queued');run.input.transcript=input.transcript;await runWorkflow(run);assert.equal(run.status,'awaiting_metrics');assert.equal(api.calls.filter(s=>s==='research').length,1);}finally{globalThis.fetch=original;}
});
test('unverified claims trigger HOTL intervention and require a recorded decision',async()=>{
  const original=globalThis.fetch;const api=mock({risk:true});globalThis.fetch=api.fetch;
  try{const run=createRun(input);await runWorkflow(run);assert.equal(run.status,'awaiting_review');assert.equal(agentState(run,'publishing').status,'queued');await assert.rejects(()=>approveRisk(run,'短い'),/10文字/);await approveRisk(run,'除外された指摘の根拠と修正稿を確認して再開します');await runWorkflow(run);assert.equal(run.status,'awaiting_metrics');assert.equal(api.calls.filter(s=>s==='final_check').length,1);assert.equal(await verifyAudit(run.audit),true);}finally{globalThis.fetch=original;}
});
test('parallel agent failure preserves successful work and retries only the failed stage',async()=>{
  const original=globalThis.fetch;const api=mock({failOnce:'style'});globalThis.fetch=api.fetch;
  try{const run=createRun(input);await runWorkflow(run);assert.equal(run.status,'failed');assert.equal(agentState(run,'facts').status,'done');assert.equal(agentState(run,'style').status,'failed');await runWorkflow(run);assert.equal(run.status,'awaiting_metrics');assert.equal(api.calls.filter(s=>s==='style').length,2);assert.equal(api.calls.filter(s=>s==='facts').length,1);assert.equal(await verifyAudit(run.audit),true);}finally{globalThis.fetch=original;}
});
test('WordPress output escapes user-provided HTML',()=>{assert.ok(makeWordPressHTML('<script>title</script>','<img src=x onerror=alert(1)>').includes('&lt;img'));assert.ok(!makeWordPressHTML('title','<script>bad</script>').includes('<script>'));});
test('editor revisions update the workflow draft and invalidate downstream artifacts and approvals',async()=>{
  const run=createRun(input);agentState(run,'rewrite').output={title:'原稿',article:'修正前'};agentState(run,'archive').status='done';run.approvals.publication={hash:'old'};
  await applyEditorialRevision(run,'修正後');
  assert.equal(agentState(run,'rewrite').output.article,'修正後');assert.equal(agentState(run,'archive').status,'queued');assert.deepEqual(run.approvals,{});assert.equal(run.status,'ready');assert.equal(await verifyAudit(run.audit),true);
});
test('past article figures never become current evidence and an unsupported draft pauses for human review',async()=>{
 const original=globalThis.fetch,payloads=[];globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);payloads.push(body);let output=fixture(body.agent);if(['writing','rewrite'].includes(body.agent))output={summary:'原稿',title:'業務改善',article:'改善は95％でした。'};return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});};
 try{const run=createRun({...input,editorialContext:{categoryNames:['DX'],references:[{title:'過去記事',excerpt:'改善は95％でした。'}]}});await runWorkflow(run);assert.equal(run.status,'awaiting_review');assert.equal(run.editorialChecks[0].quote,'95％');assert.equal(agentState(run,'publishing').status,'queued');const writing=payloads.find(p=>p.agent==='writing').input;assert.ok(writing.editorialContext.references.length);assert.ok(!JSON.stringify(writing.sourceMaterial).includes('95％'));assert.ok(!JSON.stringify(writing.transcript).includes('95％'));await approveRisk(run,'対象と原文を人が確認し、再開の判断を記録しました');await runWorkflow(run);assert.equal(run.status,'awaiting_metrics');assert.deepEqual(agentState(run,'titles').output.categories,[]);}finally{globalThis.fetch=original;}
});
test('unsupported SNS figures trigger a second review and approval applies to the public wording',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);const out=body.agent==='social'?{summary:'投稿',posts:[{platform:'X',text:'95％の改善。［記事URL］'}]}:fixture(body.agent);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(out)}}]});};
 try{const run=createRun(input);await runWorkflow(run);assert.equal(run.status,'awaiting_review');assert.equal(agentState(run,'archive').status,'queued');assert.ok(run.editorialChecks.some(c=>c.title.startsWith('タイトル・SNS')));await approveRisk(run,'SNSの数字の原文と条件を確認して続行することを決定');await runWorkflow(run);assert.equal(run.status,'awaiting_metrics');}finally{globalThis.fetch=original;}
});
test('selected work completes its prerequisites, preserves output and resumes the full production without repeating completed tasks',async()=>{const original=globalThis.fetch,api=mock();globalThis.fetch=api.fetch;try{const run=createRun(input);await runWorkflow(run,{target:'interview'});assert.equal(run.status,'task_completed');assert.deepEqual(api.calls,['research','planning','interview']);assert.equal(agentState(run,'writing').status,'queued');await runWorkflow(run,{target:'writing'});assert.equal(run.status,'task_completed');assert.equal(api.calls.filter(id=>id==='research').length,1);assert.equal(agentState(run,'facts').status,'queued');await runWorkflow(run);assert.equal(run.status,'awaiting_metrics');assert.equal(api.calls.length,15);}finally{globalThis.fetch=original;}});
test('selecting a downstream task still stops for missing interview and human review and does not bypass publication gates',async()=>{const original=globalThis.fetch,api=mock({risk:true});globalThis.fetch=api.fetch;try{const run=createRun({...input,transcript:''});await runWorkflow(run,{target:'social'});assert.equal(run.status,'awaiting_transcript');assert.equal(api.calls.length,4);run.input.transcript=input.transcript;await runWorkflow(run,{target:'social'});assert.equal(run.status,'awaiting_review');assert.equal(agentState(run,'social').status,'queued');await approveRisk(run,'資料と根拠を人が確認して投稿案の制作を再開します');await runWorkflow(run,{target:'social'});assert.equal(run.status,'task_completed');assert.equal(agentState(run,'archive').status,'queued');assert.equal(await publicationApproved(run),false);assert.equal(await verifyAudit(run.audit),true);}finally{globalThis.fetch=original;}});
test('a title-only request stops before SNS and unknown work cannot invoke any model',async()=>{const original=globalThis.fetch,api=mock();globalThis.fetch=api.fetch;try{const run=createRun(input);await runWorkflow(run,{target:'titles'});assert.equal(run.status,'task_completed');assert.equal(agentState(run,'social').status,'queued');assert.ok(!api.calls.includes('publishing'));const count=api.calls.length;await assert.rejects(()=>runWorkflow(run,{target:'shell'}));assert.equal(api.calls.length,count);}finally{globalThis.fetch=original;}});

test('an unavailable invitation draft does not block supplied interview material or the manuscript',async()=>{
 const original=globalThis.fetch,api=mock({failOnce:'coordination'});globalThis.fetch=api.fetch;
 try{const run=createRun(input);await runWorkflow(run);assert.equal(run.status,'awaiting_metrics');assert.equal(agentState(run,'coordination').status,'failed');assert.equal(agentState(run,'writing').status,'done');assert.equal(agentState(run,'interview').status,'done');assert.equal(await publicationApproved(run),false);assert.equal(await verifyAudit(run.audit),true);await runWorkflow(run,{target:'coordination'});assert.equal(run.status,'task_completed');assert.equal(api.calls.filter(id=>id==='writing').length,1);assert.equal(api.calls.filter(id=>id==='coordination').length,2);}finally{globalThis.fetch=original;}
});
test('a requested invitation failure remains visible and cannot be marked completed',async()=>{
 const original=globalThis.fetch,api=mock({failOnce:'coordination'});globalThis.fetch=api.fetch;
 try{const run=createRun(input);await runWorkflow(run,{target:'coordination'});assert.equal(run.status,'failed');assert.equal(agentState(run,'coordination').status,'failed');assert.equal(agentState(run,'interview').status,'queued');assert.equal(agentState(run,'writing').status,'queued');}finally{globalThis.fetch=original;}
});
test('invitation cancellation still stops production and never bypasses missing interview material',async()=>{
 const executeAgent=async({id})=>{if(id==='coordination'){const error=new Error('stopped');error.name='AbortError';throw error;}return {output:fixture(id),annotations:[],usage:{}};};
 const run=createRun(input);await runWorkflow(run,{executeAgent});assert.equal(run.status,'cancelled');assert.equal(agentState(run,'writing').status,'queued');
 const api=mock({failOnce:'coordination'}),original=globalThis.fetch;globalThis.fetch=api.fetch;try{const withoutInterview=createRun({...input,transcript:''});await runWorkflow(withoutInterview);assert.equal(withoutInterview.status,'awaiting_transcript');assert.equal(agentState(withoutInterview,'writing').status,'queued');}finally{globalThis.fetch=original;}
});
