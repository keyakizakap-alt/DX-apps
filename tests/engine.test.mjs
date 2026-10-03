import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE, localReview, validateAIFindings, revisedDraft, acceptanceError } from '../dist/engine.js';

test('sample detects numeric discrepancy, unmatched quote, and two explicit style rules',()=>{
  const findings=localReview(SAMPLE.draft,SAMPLE.transcript,SAMPLE.rules);
  assert.equal(findings.length,4);
  assert.equal(findings.filter(f=>f.category==='表記').length,2);
  const number=findings.find(f=>f.category==='数値');
  assert.ok(number.quote.includes('50%'));
  assert.ok(number.evidence.includes('30%'));
  assert.ok(number.suggestion.includes('30%'));
  const quote=findings.find(f=>f.category==='引用');
  assert.ok(quote.quote.includes('すべてのお客様'));
  assert.ok(quote.evidence.includes('一部のお客様'));
  assert.equal(quote.suggestion,'');
});
test('matching quotes and numbers do not generate findings',()=>{
  assert.equal(localReview('「一部の顧客で効果を確認しました」。作成時間を30%削減できました。','一部の顧客で効果を確認しました。作成時間を30%削減できました。','').length,0);
});
test('fictional or mismatched evidence and unknown anchors are rejected',()=>{
  const base={category:'文意',severity:'check',title:'断定の確認',explanation:'限定条件を確認',quote:'全員が改善した。',suggestion:'一部が改善した。',source_id:'T1',evidence:'一部が改善した。'};
  const output=validateAIFindings([base,{...base,source_id:'T999'},{...base,evidence:'存在しない発言'},{...base,quote:'存在しない原稿'},{...base,category:'架空カテゴリ'}],'全員が改善した。','一部が改善した。','');
  assert.equal(output.findings.length,1);
  assert.equal(output.rejected,4);
});
test('edits use original offsets and preserve literal dollar replacement characters',()=>{
  const fs=localReview('Webで共有。ユーザー毎に確認。','資料。','表記：Web → ウェブ\n表記：毎 → ごと');
  fs.forEach(f=>f.status='accepted');
  assert.equal(revisedDraft('Webで共有。ユーザー毎に確認。',fs),'ウェブで共有。ユーザーごとに確認。');
  fs[0].suggestion='$&は文字列。';
  assert.equal(revisedDraft('Webで共有。ユーザー毎に確認。',fs),'$&は文字列。ユーザーごとに確認。');
});
test('overlapping revisions cannot be adopted together',()=>{
  const fs=localReview('Webを毎日見る。','資料。','表記：Web → ウェブ\n表記：毎 → ごと');
  fs[0].status='accepted';
  assert.match(acceptanceError(fs[1],fs),/重複/);
  fs[1].status='accepted';
  assert.throws(()=>revisedDraft('Webを毎日見る。',fs),/重複/);
});
test('repeated anchors and empty proposals require manual intervention',()=>{
  const fs=localReview('Web。Web。','資料。','表記：Web → ウェブ');
  assert.match(acceptanceError(fs[0],fs),/複数/);
  const quote=localReview('「すべてのお客様に効果がある」。','一部のお客様に効果がある。','')[0];
  assert.match(acceptanceError(quote,[quote]),/入力/);
});
