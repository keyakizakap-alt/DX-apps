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
