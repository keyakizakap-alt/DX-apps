import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAIFindings,proposedRevision} from '../dist/engine.js';
import {agentOutputBudget} from '../dist/agent-input.js';
import {WORKFLOW_AGENTS} from '../dist/agents.js';
test('proposed corrections keep names, conditions and all untouched paragraphs',()=>{
 const original='ネクストワークの山田氏は「一部で改善した」と語る。\n対象部署の作成時間は50%短縮した。対象外の部署は調査していない。';
 const item={category:'数値',severity:'check',title:'対象部署の数字',explanation:'取材と比較',quote:'50%',source_id:'T1',evidence:'30%',suggestion:'30%'};
 const result=validateAIFindings([item],original,'対象部署の作成時間は30%短縮した。','');
 const proposal=proposedRevision(original,result.findings);
 assert.equal(proposal.article,original.replace('50%','30%'));
 assert.equal(proposal.applied.length,1);assert.deepEqual(proposedRevision(original,[]),{article:original,applied:[],skipped:[]});
 const bad=validateAIFindings([{...item,source_id:'T1,T2'},{...item,evidence:'30% すべて改善'}],original,'対象部署の作成時間は30%短縮した。','');
 assert.equal(bad.rejected,2);assert.equal(bad.findings.length,0);
});
test('overlapping proposals and rule-driven changes inside direct quotes are left for review',()=>{
 const draft='山田氏は「改善しました」と語る。50%短縮。';
 const items=[{category:'文体',severity:'style',title:'口調',explanation:'本文の文体',quote:'改善しました',source_id:'R1',evidence:'だ・である調',suggestion:'改善した'},{category:'数値',severity:'check',title:'数値',explanation:'取材',quote:'50%',source_id:'T1',evidence:'30%',suggestion:'30%'},{category:'文意',severity:'check',title:'対象',explanation:'対象',quote:'50%短縮',source_id:'T1',evidence:'30%',suggestion:'一部で30%短縮'}];
 const valid=validateAIFindings(items,draft,'一部で30%短縮。','本文はだ・である調。');
 const proposal=proposedRevision(draft,valid.findings);
 assert.equal(proposal.article,'山田氏は「改善しました」と語る。30%短縮。');assert.equal(proposal.skipped.length,2);
});
test('short articles reserve fewer output tokens and specialist schemas reject category drift',()=>{
 assert.equal(agentOutputBudget('writing',{targetLength:1500}),3000);
 assert.equal(agentOutputBudget('writing',{targetLength:100000}),8000);
 assert.equal(agentOutputBudget('writing',{targetLength:'invalid'}),4000);
 assert.deepEqual(WORKFLOW_AGENTS.find(a=>a.id==='style').schema.properties.findings.items.properties.category.enum,['表記','文体']);
 assert.equal(WORKFLOW_AGENTS.find(a=>a.id==='rewrite').role,'local');
});
test('unsupported extrema are not proposed even with a valid literal source',()=>{
 const result=validateAIFindings([{category:'数値',severity:'check',title:'数字',explanation:'取材',quote:'50%',source_id:'T1',evidence:'ある支援先で30%削減した。',suggestion:'最大30%'}],'50%削減。','ある支援先で30%削減した。','');
 assert.equal(result.findings.length,0);assert.deepEqual(result.rejectionReasons,{expanded_claim:1});
});
test('server limits citation IDs and evidence to the masked task input, without changing privacy policy',async()=>{
 const {createWorker}=await import('../server/worker.mjs');
 const worker=createWorker({},WORKFLOW_AGENTS),origin='https://citations.example.test',previous=fetch;let payload;
 globalThis.fetch=async(url,options)=>{payload=JSON.parse(options.body);return Response.json({choices:[]});};
 try{
 const r=await worker.fetch(new Request(origin+'/api/agents',{method:'POST',headers:{Origin:origin,'oai-authenticated-user-id':'citation-test','oai-authenticated-user-email':'user@example.test','Content-Type':'application/json','X-Data-Classification':'internal','X-Data-Consent':'confirmed','X-Redact-Pii':'true'},body:JSON.stringify({agent:'style',model:'openai/gpt-4.1-mini',input:{draft:'原稿',transcript:[{id:'T1',text:'連絡先は a@example.test。'}],rules:[{id:'R1',text:'Web → ウェブ'}]},web:false})}),{SITE_ORIGIN:origin,ALLOWED_USER_EMAILS:'user@example.test',OPENROUTER_API_KEY:'sk-or-v1-citation-test-dummy'});
 assert.equal(r.status,200);const props=payload.response_format.json_schema.schema.properties.findings.items.properties;
 assert.deepEqual(props.source_id.enum,['T1','R1']);assert.equal(props.quote.enum,undefined);assert.equal(props.suggestion.enum,undefined);assert.deepEqual(props.evidence.enum,['連絡先は ［メールアドレス］。','Web → ウェブ']);assert.equal(payload.provider.zdr,true);assert.equal(JSON.stringify(payload).includes('a@example.test'),false);
 }finally{globalThis.fetch=previous;}
});
test('workflow avoids concurrent upstream reservations through preparation, review and handoff',async()=>{
 const {createRun,runWorkflow}=await import('../dist/agents.js');let active=0,peak=0;
 const run=createRun({topic:'確認方法',audience:'担当者',goal:'取り組みを伝える',targetLength:1000,media:'記事',transcript:'田中氏は確認項目を整理した。',sources:'',rules:'',metrics:'PV 100',webSearch:false});
 await runWorkflow(run,{executeAgent:async({id})=>{
  active++;peak=Math.max(peak,active);if(active>1)throw new Error('利用枠の予約が競合しました');
  await new Promise(resolve=>setTimeout(resolve,2));active--;
  const output=['facts','style','structure','final_check'].includes(id)?{findings:[]}:id==='writing'?{summary:'取材記事',title:'確認方法',article:'田中氏は確認項目を整理した。'}:id==='research'?{summary:'調査',themes:[],facts:[],gaps:[]}:id==='titles'?{summary:'見出し',titles:['確認方法'],headings:[],tags:[],categories:[]}:id==='social'?{summary:'投稿案',posts:[]}:{summary:'準備',content:'内容',items:[]};
  return {output,annotations:[],usage:{}};
 }});
 assert.equal(peak,1);assert.equal(run.status,'completed');assert.equal(run.agents.every(s=>s.status==='done'),true);
});
