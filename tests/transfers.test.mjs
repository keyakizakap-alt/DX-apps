import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseBrief,validateMaterial,readableArtifact} from '../dist/transfers.js';
import {productionProgress} from '../dist/progress.js';
import {createRun} from '../dist/agents.js';
import {documentEntry} from '../dist/docx.js';
const input={version:1,brief:{topic:'取材記事',audience:'経営者',goal:'業務改善',targetLength:1500,transcript:'取材の発言',media:'インタビュー記事'}};
test('brief import accepts bounded input and rejects approvals, consent and unexpected settings',()=>{
 assert.equal(parseBrief(JSON.stringify(input)).topic,'取材記事');
 for(const extra of [{approvals:{}},{consent:true},{classification:'public'},{__proto__:null,model:'x'}])assert.throws(()=>parseBrief(JSON.stringify({...input,brief:{...input.brief,...extra}})));
 assert.throws(()=>parseBrief(JSON.stringify({...input,brief:{topic:'x'.repeat(301)}})));
 assert.throws(()=>parseBrief(JSON.stringify({...input,brief:{targetLength:100}})));
 assert.throws(()=>parseBrief('{"version":1,"brief":{"__proto__":{}}}'));
});
test('material import rejects unsupported types, oversize, binary and credentials',()=>{
 assert.equal(validateMaterial('取材.txt',10,'取材の発言',100),'取材の発言');
 assert.throws(()=>validateMaterial('file.html',10,'<script>',100));
 assert.throws(()=>validateMaterial('file.txt',500001,'x',100));
 assert.throws(()=>validateMaterial('file.txt',10,'x\0y',100));
 assert.throws(()=>validateMaterial('file.txt',10,'x'.repeat(101),100));
 assert.throws(()=>validateMaterial('file.txt',50,'sk-or-v1-'+'x'.repeat(20),100));
});
test('readable downloads contain article, findings and posts without requiring JSON knowledge',()=>{
 const text=readableArtifact({title:'取材記事',article:'原稿',findings:[{title:'確認',explanation:'説明',quote:'発言',evidence:'根拠',suggestion:'修正'}],posts:[{platform:'X',text:'投稿案'}]});assert.ok(text.includes('取材記事\n\n原稿'));assert.ok(text.includes('根拠：根拠'));assert.ok(text.includes('X 投稿案'));
});
test('progress distinguishes human approval from completed machine work',()=>{
 const run=createRun({});run.agents.forEach(a=>a.status='done');run.status='awaiting_review';let progress=productionProgress(run);assert.equal(progress.completed,17);assert.equal(progress.stages.find(s=>s.group==='校正').state,'waiting');
 run.status='awaiting_metrics';progress=productionProgress(run);assert.equal(progress.stages.find(s=>s.group==='公開準備').label,'公開前の確認待ち');assert.equal(progress.stages.find(s=>s.group==='振り返り').label,'公開後に入力');
 run.approvals.publication={hash:'confirmed'};assert.equal(productionProgress(run).stages.find(s=>s.group==='公開準備').state,'done');assert.equal(productionProgress(null).percent,0);
});
test('Word parser rejects malformed or oversized zip archives before decompression',()=>{
 assert.throws(()=>documentEntry(new ArrayBuffer(10)));assert.throws(()=>documentEntry(new ArrayBuffer(500001)));assert.throws(()=>documentEntry(new ArrayBuffer(100)));
});
