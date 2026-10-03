import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextAction,attentionItems} from '../dist/supervisor.js';
import {createNotificationCenter} from '../dist/notifications.js';
import {createRun,runWorkflow,MAX_WORKFLOW_CALLS} from '../dist/agents.js';
test('supervisor requires intervention for risk and publication without claiming automatic publication',()=>{
  const run=createRun({});run.status='awaiting_review';assert.equal(nextAction(run).kind,'risk');assert.deepEqual(attentionItems(run).map(i=>i.id),['risk']);
  run.status='awaiting_metrics';assert.deepEqual(attentionItems(run).map(i=>i.id),['publication','metrics']);run.approvals.publication={hash:'approved'};assert.deepEqual(attentionItems(run).map(i=>i.id),['metrics']);
});
test('notification center deduplicates renders, resolves notices, and notifies a revised article again',()=>{
  const delivered=[];const center=createNotificationCenter({deliver:r=>delivered.push(r)}),run=createRun({topic:'非公開氏名'});
  run.status='awaiting_review';center.update(run);center.update(run);assert.equal(delivered.length,1);assert.ok(!JSON.stringify(delivered).includes('非公開氏名'));center.read(delivered[0].key);assert.equal(center.records()[0].read,true);
  run.status='running';center.update(run);assert.equal(center.records()[0].active,false);run.revision++;run.status='awaiting_review';center.update(run);assert.equal(delivered.length,2);center.clear();assert.equal(center.records().length,0);
});
test('notification delivery failure cannot interrupt workflow observation',()=>{
  const center=createNotificationCenter({deliver:()=>{throw new Error('OS notification unsupported');}}),run=createRun({});run.status='awaiting_transcript';assert.doesNotThrow(()=>center.update(run));assert.equal(center.records().length,1);
});
test('publication notice does not repeat merely because metrics were added',()=>{
  const calls=[];const center=createNotificationCenter({deliver:r=>calls.push(r)}),run=createRun({});run.status='awaiting_metrics';center.update(run);run.status='completed';center.update(run);assert.equal(calls.filter(r=>r.action==='publication').length,1);
});
test('workflow execution limit stops before another paid request',async()=>{
  const run=createRun({topic:'test',audience:'test',goal:'test',sources:'',rules:'',transcript:'',metrics:''});run.attempts=MAX_WORKFLOW_CALLS;let called=false;const original=globalThis.fetch;globalThis.fetch=async()=>{called=true;throw new Error('must not call');};
  try{await runWorkflow(run);assert.equal(run.status,'budget_exceeded');assert.equal(called,false);assert.equal(run.attempts,MAX_WORKFLOW_CALLS);}finally{globalThis.fetch=original;}
});
