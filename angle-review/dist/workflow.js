import { SAMPLE } from './engine.js';
import { aiConfigured,aiSettings,modelFor,protectedInput } from './provider.js';
import { redactText,audit,verifyAudit } from './security.js';
import { WORKFLOW_AGENTS,createRun,agentState,runWorkflow,exportRun,approveRisk,approvePublication,publicationApproved } from './agents.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let run=null,controller=null,selected='research',busy=false,openReview=()=>{},approvalMode='risk';
const statusLabel={queued:'待機',running:'実行中',done:'完了',failed:'失敗',awaiting:'入力待ち',cancelled:'停止'};
const inputIDs=['topic','audience','goal','media','length','sources','rules','transcript','metrics','web-search'];
export function showWorkflow(){
  $('workflow-view').hidden=false;$('input-view').hidden=true;$('result-view').hidden=true;$('steps-review').hidden=true;
  $('nav-workflow').classList.add('active');$('nav-editor').classList.remove('active');
}
function status(message,error=false){$('workflow-status').hidden=!message;$('workflow-status').className='notice'+(error?' error':'');$('workflow-status').textContent=message;}
function readInput(){return{topic:$('wf-topic').value.trim(),audience:$('wf-audience').value.trim(),goal:$('wf-goal').value.trim(),media:$('wf-media').value,targetLength:Number($('wf-length').value),sources:$('wf-sources').value.trim(),rules:$('wf-rules').value.trim(),transcript:$('wf-transcript').value.trim(),metrics:$('wf-metrics').value.trim(),webSearch:$('wf-web-search').checked};}
function sample(){
  if(busy)return;
  if(run&&!confirm('制作ブリーフと現在の成果物を架空のサンプルで置き換えますか？'))return;
  $('wf-topic').value='業務改善を一度きりで終わらせない、継続的な改善の仕組み';
  $('wf-audience').value='中小企業の経営者と業務改善担当者';
  $('wf-goal').value='取材をもとに継続的な改善の仕組みと、AIを使う際に人が確認する役割を伝える';
  $('wf-sources').value='【架空の制作サンプル】株式会社ネクストワークは企業の業務改善を支援する。この記事は架空の取材サンプルであり、実在企業の成果を示すものではない。';
  $('wf-rules').value=SAMPLE.rules;$('wf-transcript').value=SAMPLE.transcript;$('wf-metrics').value='';$('wf-web-search').checked=false;
  run=null;selected='research';render();status('架空のブリーフと取材資料を読み込みました。AIの実行にはOpenRouterの設定が必要です。');$('brief-details').open=true;
}
function coreSignature(input){const {transcript,metrics,...core}=input;return JSON.stringify(core);}
async function start(){
  if(busy)return;
  if(!aiConfigured()){status('OpenRouterのAPIキーを設定すると、専門チームを実行できます。');$('workflow-settings').click();return;}
  let input;try{input=protectedInput(readInput());}catch(e){status(e.message,true);return;}
  if(input.webSearch&&aiSettings().classification!=='public'){status('Web検索は公開情報のみで使えます。社内資料は検索に送信しません。',true);return;}
  if(!input.topic||!input.audience||!input.goal){status('企画テーマ・想定読者・記事の目的を入力してください。',true);$('brief-details').open=true;return;}
  if(!Number.isFinite(input.targetLength)||input.targetLength<300||input.targetLength>8000){status('文字数目安は300〜8,000文字で指定してください。',true);return;}
  if(input.sources.length+input.rules.length+input.transcript.length+input.metrics.length>80000){status('資料全体は80,000文字以内にしてください。',true);return;}
  let replace=false;
  if(run){
    const changedCore=coreSignature(input)!==coreSignature(run.input);
    const changedTranscript=input.transcript!==run.input.transcript;
    const changedMetrics=input.metrics!==run.input.metrics;
    replace=changedCore||(changedTranscript&&run.status!=='awaiting_transcript')||(changedMetrics&&agentState(run,'analytics').status==='done');
    if(replace&&!confirm('処理に使う資料が変わっています。現在の成果物を保存してから、新しい制作フローを開始しますか？'))return;
  }
  if(!run||replace){run=createRun(input);await audit(run,'data_egress_confirmed',{classification:aiSettings().classification,masking:aiSettings().redact,webSearch:input.webSearch});}
  else{run.input.transcript=input.transcript;run.input.metrics=input.metrics;}
  controller=new AbortController();busy=true;status('専門チームを実行しています。完了した工程から成果物を確認できます。');$('brief-details').open=false;render();
  try{
    await runWorkflow(run,{signal:controller.signal,onUpdate:()=>render()});
    if(run.status==='awaiting_transcript'){status('企画と取材準備が完了しました。取材後に文字起こしを入力して再開してください。');$('brief-details').open=true;}
    else if(run.status==='awaiting_metrics')status('制作と公開準備が完了しました。修正稿を確認し、公開後の実績を入力すると振り返りを実行できます。');
    else if(run.status==='completed')status('専門チームの処理が完了しました。修正稿・公開準備・振り返りの成果物を確認してください。');
    else if(run.status==='awaiting_review'){selected='final_check';status('根拠不足または確認候補が見つかったため自動処理を止めました。監督者が内容を確認し、判断理由を記録すると再開できます。');}
    else status(run.error||'実行を停止しました。完了済みの工程を残して再開できます。',run.status==='failed');
  }finally{busy=false;controller=null;render();}
}
function render(){
  const agents=run?.agents||WORKFLOW_AGENTS.map(a=>({id:a.id,status:'queued',output:null}));
  const completed=agents.filter(a=>a.status==='done').length;
  $('wf-completed').textContent=`${completed} / ${WORKFLOW_AGENTS.length}`;
  const used=run?.usageRecords||[];
  $('wf-calls').textContent=run?.attempts||0;
  $('wf-tokens').textContent=used.reduce((n,a)=>n+a.promptTokens+a.completionTokens,0).toLocaleString();
  const costs=used.map(a=>a.cost);
  $('wf-cost').textContent=costs.length&&costs.every(c=>typeof c==='number')?`$${costs.reduce((a,b)=>a+b,0).toFixed(4)}`:'—';
  $('workflow-phase').textContent=busy?'実行中':({awaiting_transcript:'取材待ち',awaiting_metrics:'実績待ち',awaiting_review:'人の確認待ち',completed:'完了',failed:'要再開',cancelled:'停止'}[run?.status]||'待機中');
  $('workflow-run').disabled=busy;
  $('workflow-run').textContent=run&&!['ready','completed'].includes(run.status)?'続きから再開':run?.status==='completed'?'新しい制作を開始':'専門チームで制作を開始';
  if(run?.status==='completed')$('workflow-run').textContent='完了した成果物を確認';
  $('workflow-stop').hidden=!busy;$('workflow-sample').disabled=busy;
  inputIDs.forEach(id=>$('wf-'+id).disabled=busy);
  $('workflow-connection').textContent=aiConfigured()?`標準モデル：${aiSettings().model}`:'OpenRouterの設定が必要です';
  $('workflow-action-hint').textContent=run?.status==='awaiting_transcript'?'文字起こしを追加して、執筆以降を再開できます。':run?.status==='awaiting_metrics'?'公開後の実績は制作ブリーフから追加できます。':'取材がまだでも、企画と取材準備から始められます。';
  let html='',lastGroup='';
  for(const [index,agent] of WORKFLOW_AGENTS.entries()){
    const item=agents.find(a=>a.id===agent.id);
    if(lastGroup!==agent.group){html+=`<div class="agent-group">${esc(agent.group)}</div>`;lastGroup=agent.group;}
    html+=`<button class="agent-row ${selected===agent.id?'selected':''}" data-agent="${agent.id}" aria-pressed="${selected===agent.id}"><span class="agent-index">${String(index+1).padStart(2,'0')}</span><span class="agent-name">${esc(agent.name)}<span class="agent-description">${esc(agent.description)}</span></span><span class="agent-status ${item.status}">${statusLabel[item.status]}</span></button>`;
  }
  $('agent-list').innerHTML=html;
  $('workflow-bundle').disabled=!run;
  $('workflow-wordpress').disabled=agentState(run||{agents:[]},'archive')?.status!=='done'||!run?.approvals.publication;
  $('workflow-approve-publication').disabled=!run||!['awaiting_metrics','completed'].includes(run.status)||busy;
  $('approval-panel').hidden=run?.status!=='awaiting_review'&&approvalMode!=='publication';
  if(run?.status==='awaiting_review'){
    approvalMode='risk';$('approval-title').textContent='監督者の確認が必要です';$('approval-description').textContent=`最終の確認候補：${run.finalFindings?.length||0}件／根拠を検証できなかった指摘：${run.rejected}件。原稿と根拠を確認し、未確認事項に対応した上で再開してください。`;$('approval-submit').textContent='判断を記録して再開';
  }
  $('workflow-review').disabled=agentState(run||{agents:[]},'final_check')?.status!=='done';
  renderArtifact();
}
function renderArtifact(){
  const agent=WORKFLOW_AGENTS.find(a=>a.id===selected),item=run&&agentState(run,selected);
  $('artifact-title').textContent=agent.name;
  $('artifact-subtitle').textContent=item?.model?`${statusLabel[item.status]} · ${item.model} · ${(item.durationMs/1000).toFixed(1)}秒`:agent.description;
  $('artifact-download').disabled=!item?.output;
  if(!item?.output){
    $('artifact-content').innerHTML=`<div class="artifact-empty"><span class="line-symbol" aria-hidden="true">[ ${String(WORKFLOW_AGENTS.indexOf(agent)+1).padStart(2,'0')} ]</span><h3>${item?.status==='awaiting'?'必要な資料を待っています':item?.status==='running'?'専門エージェントが作業中です':item?.status==='failed'?'この工程で停止しました':'工程の成果物がここに届きます'}</h3><p>${esc(item?.error||agent.description)}</p><p>${item?.status==='failed'?'完了済みの工程をやり直さず、続きから再開できます。':'エージェントの出力は提案です。根拠を確認して、編集者が最終判断してください。'}</p></div>`;return;
  }
  const out=item.output;
  let html='';
  if(out.summary)html+=`<div class="artifact-summary">${esc(out.summary)}</div>`;
  if(out.article)html+=`<h3>${esc(out.title)}</h3><div class="artifact-document">${esc(out.article)}</div>`;
  if(out.content)html+=`<div class="artifact-document${selected==='archive'?' artifact-code':''}">${esc(out.content)}</div>`;
  if(out.themes?.length)html+=`<h3>企画の切り口</h3><ul>${out.themes.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`;
  if(out.facts?.length)html+=`<h3>根拠を確認できた情報</h3>${out.facts.map(f=>`<div class="evidence"><strong>${esc(f.claim)}</strong><blockquote>${esc(f.evidence)}</blockquote><div class="source-context">${esc(f.source_id)}</div></div>`).join('')}`;
  if(out.gaps?.length)html+=`<h3>追加で確認すること</h3><ul>${out.gaps.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`;
  if(out.findings){
    html+=out.findings.length?out.findings.map(f=>`<div class="artifact-finding"><span class="badge">${esc(f.category)}</span><h3>${esc(f.title)}</h3><p>${esc(f.explanation)}</p><div class="quoted">${esc(f.quote)}</div><div class="evidence"><div class="evidence-label">根拠 ${esc(f.sourceId)}</div><blockquote>${esc(f.evidence)}</blockquote></div>${f.suggestion?`<h4>修正案</h4><p>${esc(f.suggestion)}</p>`:''}</div>`).join(''):'<p>根拠を検証できた確認候補はありません。原稿の正確性を保証する結果ではありません。</p>';
    if(item.validated?.rejected)html+=`<div class="notice">${item.validated.rejected}件は根拠を検証できなかったため除外しました。</div>`;
  }
  if(out.items?.length)html+=`<h3>確認項目・次の作業</h3><ul>${out.items.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`;
  for(const [key,label] of [['titles','タイトル候補'],['headings','見出し'],['tags','タグ候補'],['categories','カテゴリ候補']])if(out[key]?.length)html+=`<h3>${label}</h3><ul>${out[key].map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`;
  if(out.posts?.length)html+=out.posts.map(p=>`<h3>${esc(p.platform)} 投稿下書き</h3><div class="artifact-document">${esc(p.text)}</div>`).join('');
  if(item.annotations?.length)html+=`<h3>検索で取得した参照先</h3><ul>${item.annotations.map(a=>`<li><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a></li>`).join('')}</ul><p>参照先の原文と、記事に使用する主張を確認してください。</p>`;
  $('artifact-content').innerHTML=html;
}
function download(content,type,name){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function initWorkflow(options={}){
  openReview=options.openReview||(()=>{});
  $('workflow-run').addEventListener('click',start);
  $('workflow-stop').addEventListener('click',()=>controller?.abort());
  $('workflow-preview').addEventListener('click',()=>{const settings=aiSettings();const input=readInput();$('privacy-preview').textContent=settings.redact?redactText(JSON.stringify(input,null,2),settings.terms):JSON.stringify(input,null,2);$('privacy-dialog').showModal();});
  $('workflow-clear').addEventListener('click',()=>{
    if(busy){status('実行を停止してから資料を消去してください。',true);return;}
    if(!confirm('入力資料・成果物・このページのAI接続情報を消去しますか？必要な記録は先に保存してください。'))return;
    run=null;approvalMode='risk';inputIDs.filter(id=>!['media','length','web-search'].includes(id)).forEach(id=>$('wf-'+id).value='');$('privacy-preview').textContent='';$('approval-reason').value='';window.dispatchEvent(new Event('data:clear'));render();status('入力と成果物を消去しました。保存済みのファイルはお手元で管理してください。');
  });
  $('workflow-sample').addEventListener('click',sample);
  $('agent-list').addEventListener('click',e=>{const b=e.target.closest('[data-agent]');if(b){selected=b.dataset.agent;render();}});
  $('workflow-bundle').addEventListener('click',()=>{if(run)download(JSON.stringify(exportRun(run),null,2),'application/json;charset=utf-8',`angle-production-${run.id}.json`);});
  $('workflow-wordpress').addEventListener('click',async()=>{const output=run&&agentState(run,'archive').output;if(!output)return;if(!await publicationApproved(run)){status('成果物が変更されています。公開用データの承認をやり直してください。',true);return;}await audit(run,'wordpress_package_exported',{approvalHash:run.approvals.publication.hash});download(output.content,'text/html;charset=utf-8','angle-wordpress-draft.html');});
  $('workflow-approve-publication').addEventListener('click',()=>{approvalMode='publication';$('approval-panel').hidden=false;$('approval-title').textContent='公開用データの承認';$('approval-description').textContent='修正稿・根拠・タイトル・SNS文案・画像の権利と未確認事項を確認してください。承認は現在の成果物に紐づきます。実際の公開・投稿はまだ行いません。';$('approval-submit').textContent='公開用データを承認';$('approval-reason').value='';$('approval-panel').scrollIntoView({behavior:'smooth',block:'center'});});
  $('approval-submit').addEventListener('click',async()=>{
    if(!run||busy)return;
    try{const reason=protectedInput($('approval-reason').value.trim());if(approvalMode==='risk'){await approveRisk(run,reason);$('approval-panel').hidden=true;await start();}else{await approvePublication(run,reason);approvalMode='risk';$('approval-panel').hidden=true;render();status('公開用データを承認しました。入稿用HTMLを保存できます。実際の公開は人が行ってください。');}}catch(e){status(e.message,true);}
  });
  $('artifact-download').addEventListener('click',()=>{const out=run&&agentState(run,selected).output;if(out)download(JSON.stringify(out,null,2),'application/json;charset=utf-8',`angle-${selected}.json`);});
  $('workflow-review').addEventListener('click',()=>{if(run)openReview(run);});
  window.addEventListener('ai:configured',render);
  window.addEventListener('workflow:updated',()=>{approvalMode='risk';render();status('編集者の修正を制作フローに反映しました。以前の公開承認は無効です。続きから再開し、最終照合と公開準備を更新してください。');});
  window.addEventListener('beforeunload',e=>{if(run){e.preventDefault();e.returnValue='';}});
  render();
  const context=document.modelContext;
  if(context?.registerTool){
    const lifecycle=new AbortController();
    try{Promise.resolve(context.registerTool({name:'read_production_workflow',description:'制作フローの工程・進捗・成果物を読み取る。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>({status:run?.status||'ready',agents:(run?.agents||[]).map(({id,status,error,output})=>({id,status,error,output}))})},{signal:lifecycle.signal})).catch(()=>{});}catch{}
    window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  }
}
