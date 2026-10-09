import {initProjectWorkspace} from './project-workspace.js';
import {initPracticalEditing} from './practical-editing.js';
import { SAMPLE, localReview, segments, validateAIFindings, revisedDraft, acceptanceError, sourceLabel } from './engine.js';
import { configureAI,aiConfigured,aiSettings,protectedInput,discoverServer } from './provider.js';
import { runReviewTeam,applyEditorialRevision } from './agents.js';
import { initWorkflow,showWorkflow } from './workflow.js';
import { initDashboard } from './dashboard.js';
import { initTransfers } from './transfers.js';
const $ = id => document.getElementById(id);
let state = { findings: [], original: '', title: '', transcript: '', rules: '', selected: '', revised: false, started: 0, isSample: true, mode: 'basic', busy: false };
let timer;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notify(message, error = false) { $('notice').textContent = message; $('notice').className = 'notice' + (error ? ' error' : ''); $('notice').hidden = false; }
function hideNotice() { $('notice').hidden = true; }
function setStep(step) { ['input','review','export'].forEach(s => $('step-'+s).classList.toggle('current', s === step)); }
function switchTab(tab) {
  ['draft','transcript','rules'].forEach(t => { $('pane-'+t).hidden = t !== tab; $('tab-'+t).classList.toggle('active', t === tab); $('tab-'+t).setAttribute('aria-selected', String(t === tab)); $('tab-'+t).tabIndex = t === tab ? 0 : -1; });
}
function updateInputs() {
  ['draft','transcript','rules'].forEach(k => { $(k+'-count').textContent = `${$(k).value.length.toLocaleString()}文字`; $(k+'-indicator').classList.toggle('missing',!$(k).value.trim()); });
  $('sample-badge').hidden = !state.isSample;
}
function loadSample(force = false) {
  if (!force && (!state.isSample || state.findings.some(f => f.status === 'accepted')) && !window.confirm('入力内容とレビュー結果をサンプルで置き換えますか？')) return;
  $('article-title').value = SAMPLE.title;
  ['draft','transcript','rules'].forEach(k => $(k).value = SAMPLE[k]);
  state = { ...state, findings: [], isSample: true, busy: false,workflowRun:null };
  clearInterval(timer); showInput(false); switchTab('draft'); updateInputs(); hideNotice();
}
function showInput(confirmLoss = true) {
  if(state.busy)return;
  if (confirmLoss && state.findings.some(f => f.status === 'accepted') && !confirm('採用済みの修正は「修正稿を書き出す」で保存できます。入力に戻りますか？')) return;
  window.dispatchEvent(new CustomEvent('workspace:navigate',{detail:'editor'}));
  $('input-view').hidden = false; $('result-view').hidden = true; setStep('input'); clearInterval(timer); hideNotice();
  $('workflow-view').hidden=true;$('steps-review').hidden=false;
  $('nav-workflow').classList.remove('active');$('nav-editor').classList.add('active');
}
function updateConnection(emit=true) {
  const connected = aiConfigured();
  $('connection-status').textContent = connected ? '記事制作・校正が使えます' : '基本チェックが使えます';
  $('mode-description').textContent = connected ? '引用・数値、表記、記事の構成をまとめて確認します。' : '表記・数値・引用を資料と照合します。';
  $('run-review').innerHTML = '<span aria-hidden="true">✦</span> ' + (connected ? '原稿を確認する' : 'レビューを開始');
  if(emit)window.dispatchEvent(new Event('ai:configured'));
}
async function reviewWithAI(draft, transcript, rules) {
  $('review-team-status').hidden=false;
  return runReviewTeam({draft,transcript,rules,onStatus:(id,status,error)=>{
    const el=document.querySelector(`[data-review-agent="${id}"]`);
    el.textContent=({facts:'事実・引用',style:'表記・校正',structure:'構成'}[id])+': '+({running:'照合中',done:'完了',failed:'失敗',cancelled:'停止'}[status]||status);
    el.dataset.status=status;if(error)el.title=error;
  }});
}
async function runReview() {
  if (state.busy) return;
  hideNotice();
  let draft = $('draft').value.trim(), transcript = $('transcript').value.trim(), rules = $('rules').value.trim();
  if (!draft) { switchTab('draft'); $('draft').focus(); notify('レビューする初稿を入力してください。', true); return; }
  if (!transcript) { switchTab('transcript'); $('transcript').focus(); notify('取材の文字起こしを入力してください。根拠との照合に使用します。', true); return; }
  if (draft.length + transcript.length + rules.length > 80000) { notify('入力全体は80,000文字以内にしてください。記事を分けてレビューできます。', true); return; }
  try{if(aiConfigured())({draft,transcript,rules}=protectedInput({draft,transcript,rules}));}catch(e){notify(e.message,true);return;}
  state.busy = true; $('run-review').disabled = true; $('load-sample').disabled = true; $('sample-nav').disabled = true;
  ['draft','transcript','rules','article-title','media'].forEach(k => $(k).disabled = true);
  $('run-review').textContent = aiConfigured() ? '制作サポートで照合しています…' : '照合しています…';
  const started = Date.now();
  try {
    let findings, rejected = 0, failures=[];
    if (aiConfigured()) { const result = await reviewWithAI(draft, transcript, rules); findings = result.findings; rejected = result.rejected;failures=result.failures; }
    else { await new Promise(r => setTimeout(r, 250)); findings = localReview(draft, transcript, rules); }
    state = { ...state, findings, original:draft, title:$('article-title').value.trim() || '無題の記事', transcript, rules, selected:findings[0]?.id || '', revised:false, started, mode:aiConfigured()?'ai':'basic',workflowRun:null };
    $('filter').value = 'all'; $('input-view').hidden = true; $('result-view').hidden = false; setStep('review'); render();
    clearInterval(timer); timer = setInterval(updateElapsed, 1000); updateElapsed();
    if(failures.length)notify(`一部の確認が終わっていません。完了した確認のみ表示しています。${failures[0]}`,true);
    else if (rejected) notify(`${rejected}件の指摘は根拠や原稿の引用を検証できなかったため表示していません。表示件数が少なくても確認済みとは限りません。`);
    else if (!aiConfigured()) notify('基本チェックの結果です。文意のずれや事実の正誤は判定していません。数値・引用の指摘は確認候補です。');
    window.scrollTo({top:0, behavior:'smooth'});
  } catch (e) { notify(e.message || 'レビュー中にエラーが発生しました。入力内容は保持しています。', true); }
  finally { state.busy = false; $('run-review').disabled = false; $('load-sample').disabled = false; $('sample-nav').disabled = false; ['draft','transcript','rules','article-title','media'].forEach(k => $(k).disabled = false); updateConnection(); }
}
function updateElapsed() {
  const sec = Math.max(0,Math.floor((Date.now()-state.started)/1000));
  $('elapsed-time').textContent = `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
}
function renderArticle() {
  $('show-original').classList.toggle('selected',!state.revised); $('show-revised').classList.toggle('selected',state.revised);
  let html = '';
  if (state.revised) html = esc(revisedDraft(state.original,state.findings));
  else {
    const anchors = [...state.findings].filter(f => f.status !== 'dismissed').sort((a,b) => a.start-b.start);
    let pos = 0;
    for (const f of anchors) {
      if (f.start < pos || f.start < 0) continue;
      html += esc(state.original.slice(pos,f.start));
      html += `<mark class="highlight${state.selected === f.id ? ' active':''}${f.status === 'accepted' ? ' accepted':''}" tabindex="0" role="button" data-finding="${esc(f.id)}" aria-label="${esc(f.title)}">${esc(f.quote)}</mark>`;
      pos = f.end;
    }
    html += esc(state.original.slice(pos));
  }
  $('article-content').innerHTML = html;
}
function renderFindings() {
  const filter = $('filter').value;
  const findings = state.findings.filter(f => filter === 'all' || f.status === filter);
  if (!findings.length) {
    $('findings-list').innerHTML = `<div class="empty-findings"><h3>${state.findings.length ? 'この条件の指摘はありません':'確認候補は見つかりませんでした'}</h3><p>${state.findings.length ? '絞り込みを変更して、ほかの指摘を確認できます。':'引用・数値・取材の意図を、公開前に編集者が最終確認してください。'}</p></div>`; return;
  }
  $('findings-list').innerHTML = findings.map((f) => {
    const status = {pending:'未対応',accepted:'採用済み',dismissed:'却下済み'}[f.status];
    const tag = f.status === 'pending' ? (f.severity === 'style' ? 'style':'') : f.status;
    return `<article class="finding${state.selected === f.id ? ' selected':''}" id="card-${esc(f.id)}"><div class="finding-header"><span class="finding-tag ${tag}">${esc(f.category)}</span><span>${status} · ${state.mode==='ai'?'AI照合':'基本チェック'}</span></div><h4>${esc(f.title)}</h4><p>${esc(f.explanation)}</p><div class="quoted">${esc(f.quote)}</div><div class="evidence"><div class="evidence-label">根拠：${esc(sourceLabel(f.sourceId))}</div><blockquote>${esc(f.evidence || '対応する発言を特定できませんでした。文字起こし全体を確認してください。')}</blockquote>${f.evidence?'<div class="source-context">入力された資料から引用</div>':''}</div><div class="suggestion"><label for="suggest-${esc(f.id)}">修正案 ${f.status==='pending'?'（編集できます）':''}</label><textarea id="suggest-${esc(f.id)}" data-suggestion="${esc(f.id)}" ${f.status!=='pending'?'readonly':''} placeholder="根拠を確認して、採用する文章を入力してください。">${esc(f.suggestion)}</textarea></div><div class="finding-actions">${f.status==='pending'?`<button class="button secondary" data-action="dismiss" data-id="${esc(f.id)}">却下</button><button class="button primary" data-action="accept" data-id="${esc(f.id)}">修正を採用</button>`:`<button class="button secondary" data-action="undo" data-id="${esc(f.id)}">${f.status==='accepted'?'採用を取り消す':'未対応に戻す'}</button>`}</div></article>`;
  }).join('');
}
function render() {
  $('result-title').textContent = state.title;
  $('result-info').textContent = `${state.mode==='ai'?'原稿の校正':'基本チェック'} · ${state.original.length.toLocaleString()}文字${state.isSample?' · 架空のサンプル':''}`;
  $('total-count').textContent = state.findings.length;
  $('pending-count').textContent = state.findings.filter(f=>f.status==='pending').length;
  $('accepted-count').textContent = state.findings.filter(f=>f.status==='accepted').length;
  renderArticle(); renderFindings();
}
function act(id, action) {
  const finding = state.findings.find(f=>f.id===id); if (!finding) throw new Error('指摘が見つかりません。');
  if (action==='accept') { const error = acceptanceError(finding,state.findings); if(error){notify(error,true);return {ok:false,error};} finding.status='accepted'; }
  else if(action==='dismiss') finding.status='dismissed';
  else if(action==='undo') finding.status='pending';
  else throw new Error('操作を確認できません。');
  state.selected=id; hideNotice(); render();
  if(state.workflowRun)void applyEditorialRevision(state.workflowRun,revisedDraft(state.original,state.findings)).then(()=>window.dispatchEvent(new Event('workflow:updated'))).catch(()=>notify('制作フローへの修正反映を確認できませんでした。',true));
  return {ok:true,id,status:finding.status};
}
function selectFinding(id) {
  state.selected=id;
  if ($('filter').value !== 'all' && !state.findings.some(f=>f.id===id&&f.status===$('filter').value)) $('filter').value='all';
  render(); $('card-'+id)?.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function openExport() {
  hideNotice();
  $('export-text').value = revisedDraft(state.original,state.findings);
  const accepted = state.findings.filter(f=>f.status==='accepted').length, pending = state.findings.filter(f=>f.status==='pending').length;
  $('export-summary').textContent = `${accepted}件の修正を反映しました。${pending?`未対応の確認候補が${pending}件あります。`:'公開前に原稿を最終確認してください。'}`;
  $('export-status').textContent=''; setStep('export'); $('export-dialog').showModal();
}
function saveFile(text, type, name) {
  const url=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement('a'); a.href=url; a.download=name; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  $('export-status').textContent='ファイルを書き出しました。';
}
function fileName() { return state.title.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,70) || '原稿'; }
function reviewRecord() { return {title:state.title,media:$('media').value,reviewMode:state.mode,isFictionalSample:state.isSample,exportedAt:new Date().toISOString(),elapsedSeconds:Math.floor((Date.now()-state.started)/1000),original:state.original,revised:revisedDraft(state.original,state.findings),findings:state.findings}; }
document.querySelectorAll('[data-tab]').forEach(b=>{
  b.addEventListener('click',()=>switchTab(b.dataset.tab));
  b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const list=['draft','transcript','rules'];const i=list.indexOf(b.dataset.tab);const next=list[(i+(e.key==='ArrowRight'?1:2))%3];switchTab(next);$('tab-'+next).focus();});
});
['draft','transcript','rules','article-title','media'].forEach(k=>$(k).addEventListener('input',()=>{state.isSample=false;updateInputs();}));
$('run-review').addEventListener('click',runReview);
$('load-sample').addEventListener('click',()=>loadSample()); $('sample-nav').addEventListener('click',()=>loadSample());
$('nav-editor').addEventListener('click',()=>showInput()); $('back-input').addEventListener('click',()=>showInput());
['settings-button','guide-settings','workflow-settings'].forEach(id=>$(id).addEventListener('click',()=>{ const settings=aiSettings();$('data-classification').value=settings.classification;$('redact-pii').checked=settings.redact;$('redact-terms').value=settings.terms;$('data-consent').checked=settings.consent; $('settings-dialog').showModal(); }));
$('settings-form').addEventListener('submit',e=>{e.preventDefault();configureAI({...aiSettings(),classification:$('data-classification').value,redact:$('redact-pii').checked,terms:$('redact-terms').value,consent:$('data-consent').checked,enabled:$('data-consent').checked});updateConnection();$('settings-dialog').close();notify(aiConfigured()?'資料の取り扱いを適用しました。送信禁止の資料はAIに送りません。':aiSettings().consent?'資料の取り扱いを保存しました。制作の接続準備が完了すると利用できます。':'資料を外部へ送信できることを確認してから、制作を開始してください。');});
$('disconnect').addEventListener('click',()=>{configureAI({...aiSettings(),enabled:false,consent:false});updateConnection();$('settings-dialog').close();notify('このページからのAIへの送信を停止しました。基本チェックを利用できます。');});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
$('export-dialog').addEventListener('close',()=>setStep('review'));
$('filter').addEventListener('change',renderFindings);
$('show-original').addEventListener('click',()=>{state.revised=false;renderArticle();}); $('show-revised').addEventListener('click',()=>{state.revised=true;renderArticle();});
$('findings-list').addEventListener('input',e=>{const id=e.target.dataset.suggestion;if(id){const f=state.findings.find(f=>f.id===id);if(f&&f.status==='pending')f.suggestion=e.target.value;}});
$('findings-list').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)act(b.dataset.id,b.dataset.action);});
$('article-content').addEventListener('click',e=>{const mark=e.target.closest('[data-finding]');if(mark)selectFinding(mark.dataset.finding);});
$('article-content').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.dataset.finding){e.preventDefault();selectFinding(e.target.dataset.finding);}});
$('export-button').addEventListener('click',openExport);
$('copy-button').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('export-text').value);$('export-status').textContent='原稿をコピーしました。';}catch{$('export-text').focus();$('export-text').select();$('export-status').textContent='コピーが許可されていません。選択された原稿を手動でコピーしてください。';}});
$('download-draft').addEventListener('click',()=>saveFile($('export-text').value,'text/plain;charset=utf-8',fileName()+'.txt'));
$('download-report').addEventListener('click',()=>saveFile(JSON.stringify(reviewRecord(),null,2),'application/json;charset=utf-8',fileName()+'-review.json'));
window.addEventListener('beforeunload',e=>{if(!state.isSample||state.findings.some(f=>f.status==='accepted')){e.preventDefault();e.returnValue='';}});
loadSample(true); updateConnection();
initWorkflow({openReview:run=>{
  const final=run.agents.find(a=>a.id==='rewrite').output||run.agents.find(a=>a.id==='writing').output;
  if(!final)return;
  $('draft').value=final.article;$('transcript').value=run.input.transcript;$('rules').value=[run.input.rules,`読者：${run.input.audience}`,`目的：${run.input.goal}`].join('\n');$('article-title').value=final.title;$('media').value=run.input.media;
  state={...state,findings:(run.finalFindings||[]).map(f=>({...f})),original:final.article,title:final.title,transcript:run.input.transcript,rules:$('rules').value,selected:run.finalFindings?.[0]?.id||'',revised:false,started:Date.now(),isSample:false,mode:'ai',workflowRun:run};
  showInput(false);updateInputs();$('input-view').hidden=true;$('result-view').hidden=false;setStep('review');render();clearInterval(timer);timer=setInterval(updateElapsed,1000);notify('制作サポートが作成した修正稿です。最終照合の指摘を確認して、公開前に編集者が承認してください。');
}});
$('nav-workflow').addEventListener('click',()=>{if(state.busy)return;clearInterval(timer);hideNotice();showWorkflow();});
initDashboard();
initTransfers();
initPracticalEditing();
void initProjectWorkspace();
window.addEventListener('ai:configured',()=>updateConnection(false));
discoverServer();
window.addEventListener('data:clear',()=>{clearInterval(timer);state={...state,findings:[],original:'',title:'',transcript:'',rules:'',isSample:false,workflowRun:null};['draft','transcript','rules','article-title','export-text','redact-terms'].forEach(id=>$(id).value='');$('article-content').textContent='';$('findings-list').textContent='';configureAI({...aiSettings(),enabled:false,consent:false,terms:''});updateInputs();updateConnection();});

// Feature-detected WebMCP tools use the same actions and state as the interface.
const context=document.modelContext;
if(context?.registerTool){
  const lifecycle=new AbortController();
  const tools=[
    {name:'read_editorial_review',description:'現在の原稿の確認の指摘と採用状態を取得する。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>({mode:state.mode,findings:state.findings.map(({id,title,quote,evidence,status})=>({id,title,quote,evidence,status}))})},
    {name:'review_sample_article',description:'架空のサンプル記事を読み込み、レビューを実行して画面に結果を表示する。既存の入力を置き換える。AI設定がある場合はOpenRouterとモデル提供元に送信する。',inputSchema:{type:'object',properties:{replaceConfirmed:{type:'boolean'}},required:['replaceConfirmed'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async input=>{if(!input||input.replaceConfirmed!==true)throw new Error('置き換えの確認が必要です。');if(state.busy)throw new Error('レビュー実行中です。');loadSample(true);await runReview();return{count:state.findings.length,mode:state.mode};}}
  ];
  for(const tool of tools){try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
