import {workspaceState,canEdit,canApprove} from './workspace-client.js';
import {validateSnapshot} from './project-snapshots.js';
import {editableFields,editedOutput,saveArtifactEdit,prepareRegeneration,restoreRegeneration} from './artifact-edits.js';
import {demoAgent,DEMO_METRICS} from './demo.js';
import { SAMPLE } from './engine.js';
import { aiConfigured,aiSettings,configureAI,protectedInput,discoverServer,connectionMessage } from './provider.js';
import {taskPlan} from './tasks.js';
import { redactText,audit,verifyAudit } from './security.js';
import { WORKFLOW_AGENTS,createRun,agentState,runWorkflow,exportRun,approveRisk,approvePublication,publicationApproved } from './agents.js';
import {productionProgress} from './progress.js';
import {nextAction} from './supervisor.js';
import {readableArtifact,downloadText} from './transfers.js';
import {selectedKnowledge,clearReferenceSelection} from './knowledge-ui.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let run=null,controller=null,selected='research',busy=false,starting=false,pendingTarget=null,openReview=()=>{},approvalMode='risk';
let demoMode=false,generatedSample=false;
const statusLabel={queued:'待機',running:'実行中',done:'完了',failed:'失敗',awaiting:'入力待ち',cancelled:'停止'};
const inputIDs=['topic','audience','goal','media','length','sources','rules','transcript','metrics','web-search'];
export function loadWorkflowSnapshot(snapshot){if(busy||starting)throw new Error('作業を停止してから記事を開いてください。');const checked=validateSnapshot(snapshot);pendingTarget=null;configureAI({...aiSettings(),consent:false,enabled:false});clearReferenceSelection();for(const id of inputIDs){const key=id==='length'?'targetLength':id==='web-search'?'webSearch':id;if(id==='web-search')$('wf-'+id).checked=checked.input[key];else $('wf-'+id).value=checked.input[key];}run=checked.run;demoMode=!!run?.demo;generatedSample=false;selected=run?.agents.find(a=>a.id==='rewrite'&&a.output)?'rewrite':'research';approvalMode='risk';pendingTarget=null;render();showWorkflow();}
export function refreshWorkflow(){render();}
export function workflowSnapshot(){return {run,busy:busy||starting,input:readInput()};}
export async function executeTask(target='all'){taskPlan(target);showWorkflow();if(target!=='all')selected=target;await start(target);}
export function openAgent(id){if(WORKFLOW_AGENTS.some(a=>a.id===id)){selected=id;showWorkflow();render();$('artifact-content').scrollIntoView({behavior:'smooth',block:'center'});}}
export function showWorkflow(){
  window.dispatchEvent(new CustomEvent('workspace:navigate',{detail:'workflow'}));
  $('workflow-view').hidden=false;$('input-view').hidden=true;$('result-view').hidden=true;$('steps-review').hidden=true;
  $('nav-workflow').classList.add('active');$('nav-editor').classList.remove('active');
}
function status(message,error=false){$('workflow-status').hidden=!message;$('workflow-status').className='notice'+(error?' error':'');$('workflow-status').textContent=message;}
function readInput(){return{topic:$('wf-topic').value.trim(),audience:$('wf-audience').value.trim(),goal:$('wf-goal').value.trim(),media:$('wf-media').value,targetLength:Number($('wf-length').value),sources:$('wf-sources').value.trim(),rules:$('wf-rules').value.trim(),transcript:$('wf-transcript').value.trim(),metrics:$('wf-metrics').value.trim(),webSearch:$('wf-web-search').checked,editorialContext:selectedKnowledge()};}
function sample({demo=false}={}){
  if(busy||starting||!canEdit())return false;
  if((run||readInput().topic)&&!confirm('企画・取材資料と現在の成果物を架空のサンプルで置き換えますか？'))return false;
  $('wf-topic').value='業務改善を一度きりで終わらせない、継続的な改善の仕組み';
  $('wf-audience').value='中小企業の経営者と業務改善担当者';
  $('wf-goal').value='取材をもとに継続的な改善の仕組みと、AIを使う際に人が確認する役割を伝える';
  $('wf-sources').value='【架空の制作サンプル】株式会社ネクストワークは企業の業務改善を支援する。この記事は架空の取材サンプルであり、実在企業の成果を示すものではない。';
  $('wf-rules').value=SAMPLE.rules;$('wf-transcript').value=SAMPLE.transcript;$('wf-metrics').value='';$('wf-web-search').checked=false;
  demoMode=demo;generatedSample=false;pendingTarget=null;run=null;selected='research';render();status('架空のブリーフと取材資料を読み込みました。AIを使う前に、資料の取り扱いを確認してください。');$('brief-details').open=true;$('materials-details').open=true;return true;
}
function coreSignature(input){const {transcript,metrics,...core}=input;return JSON.stringify(core);}
async function start(target='all'){
  if(busy||starting)return;
  starting=true;try{await startProduction(target);}catch(e){status(e.message||'作業を開始できませんでした。',true);}finally{starting=false;render();}
}
async function startProduction(target){
  taskPlan(target);
  if(!canEdit()){status('閲覧用の記事です。編集担当者に依頼してください。');return;}
  if(workspaceState().available&&!workspaceState().user&&!demoMode){pendingTarget=target;$('workspace-login').click();return;}
  if(run?.status==='budget_exceeded'){status(run.error,true);return;}
  const raw=readInput(),missing=[['topic','企画テーマ'],['audience','想定読者'],['goal','記事の目的']].filter(([key])=>!raw[key]);
  if(missing.length){status(`${missing.map(([,label])=>label).join('・')}を入力してください。入力後、制作を開始できます。`);$('brief-details').open=true;$('wf-'+missing[0][0]).focus();return;}
  if(!demoMode){status('制作を利用できるか確認しています。');render();await discoverServer();}
  if(!demoMode&&!aiSettings().serverReady){status(connectionMessage());$('workflow-reconnect').hidden=false;return;}
  if(!demoMode&&(!aiConfigured()||!aiSettings().consent)){pendingTarget=target;status('資料の取り扱いを確認すると、選択した制作を開始します。');$('workflow-settings').click();return;}
  let input;try{input=demoMode?{...raw,webSearch:false,editorialContext:null}:protectedInput(raw);}catch(e){status(e.message,true);return;}
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
  if(!run||replace){run=createRun(input);run.demo=demoMode;await audit(run,demoMode?'demo_started':'data_egress_confirmed',demoMode?{simulated:true,externalRequests:false}:{classification:aiSettings().classification,masking:aiSettings().redact,webSearch:input.webSearch});}
  else{run.input.transcript=input.transcript;run.input.metrics=input.metrics;}
  controller=new AbortController();busy=true;status('記事の制作を開始しています。完了した工程から成果物を確認できます。');$('brief-details').open=false;render();
  try{
    await runWorkflow(run,{signal:controller.signal,onUpdate:()=>{if(!agentState(run,selected)?.output){const completed=run.agents.filter(a=>a.status==='done'&&a.output);if(completed.length)selected=completed.at(-1).id;}render();},target,...(demoMode?{executeAgent:demoAgent}:{})});
    if(run.status==='task_completed'){selected=target;status('選択した作業が完了しました。成果物を確認できます。次の工程は「制作の続きを進める」から開始できます。');}
    else if(run.status==='awaiting_transcript'){status('企画と取材準備が完了しました。取材後に文字起こしを入力して再開してください。');$('brief-details').open=true;$('materials-details').open=true;}
    else if(run.status==='awaiting_metrics'){selected='rewrite';status('原稿と公開準備の内容を生成しました。作業一覧から企画・校正結果・見出し・SNS文案も確認できます。公開実績を入力するまで振り返りは実行しません。');}
    else if(run.status==='completed'){if(demoMode)selected='analytics';status(demoMode?'振り返りまでのデモが完了しました。架空の実績から次の改善案を確認できます。':'記事の制作が完了しました。修正稿・公開準備・振り返りの成果物を確認してください。');}
    else if(run.status==='awaiting_review'){selected=run.reviewScope==='public'?'social':'final_check';status('資料で確認が必要な箇所が見つかりました。編集担当者が内容を確認し、判断理由を記録すると再開できます。');}
    else status(run.error||'実行を停止しました。完了済みの工程を残して再開できます。',run.status==='failed');
  }finally{busy=false;controller=null;render();}
}
function render(){
  const knowledge=selectedKnowledge();$('workflow-references').innerHTML=`<strong>参考記事${knowledge?'：'+knowledge.references.length+'本を選択':'を活かす'}</strong><p>${knowledge?knowledge.references.map(r=>esc(r.title)).join('<br>'):'過去記事から、切り口・構成・分類のヒントを選べます。'}</p><button class="button secondary" data-section="knowledge" ${busy?'disabled':''}>過去記事を探す</button>`;
  const agents=run?.agents||WORKFLOW_AGENTS.map(a=>({id:a.id,status:'queued',output:null}));
  const completed=agents.filter(a=>a.status==='done').length;
  $('wf-completed').textContent=`${completed} / ${WORKFLOW_AGENTS.length}`;
  $('wf-calls').textContent=run?.attempts||0;
  const progress=productionProgress(run),next=nextAction(run);
  $('project-progress-title').textContent=next.title;
  $('project-progress-description').textContent=next.reason;
  $('project-progress-percent').textContent=progress.percent+'%';
  $('project-progress-bar').value=progress.completed;
  $('project-stages').innerHTML=progress.stages.map((stage,index)=>`<button class="project-stage ${stage.state}" data-progress-agent="${stage.firstAgent}"><span class="project-stage-index">${stage.state==='done'?'✓':index+1}</span><strong>${esc(stage.group)}</strong><span class="project-stage-label">${esc(stage.label)}</span><progress value="${stage.done}" max="${stage.total}" aria-label="${esc(stage.group)}の進み具合"></progress><small>${stage.done} / ${stage.total} 作業</small></button>`).join('');
  $('workflow-phase').textContent=busy?'実行中':starting?'準備を確認中':({task_completed:'作業完了',awaiting_transcript:'取材待ち',awaiting_metrics:'実績待ち',awaiting_review:'人の確認待ち',completed:'完了',failed:'要再開',cancelled:'停止',budget_exceeded:'処理上限'}[run?.status]||'待機中');
  $('workflow-run').disabled=busy||starting||!canEdit()||run?.status==='budget_exceeded';
  $('workflow-run').textContent=run&&!['ready','completed'].includes(run.status)?'続きから再開':run?.status==='completed'?'新しい制作を開始':'記事の制作を始める';
  if(run?.status==='completed')$('workflow-run').textContent='完了した成果物を確認';
  if(run?.status==='task_completed'||run?.status==='ready'&&run.agents.some(a=>a.output))$('workflow-run').textContent='制作の続きを進める';
  $('workflow-generated-note').hidden=!generatedSample;
  $('workflow-generate').disabled=busy||starting||!canEdit();
  $('workflow-demo-note').hidden=!demoMode;
  $('workflow-demo').disabled=busy||starting||!canEdit();
  $('workflow-demo-exit').disabled=busy||starting;
  $('workflow-demo-metrics').hidden=!demoMode||run?.status!=='awaiting_metrics';
  $('workflow-demo-metrics').disabled=busy||!run?.approvals?.publication;
  $('workflow-stop').hidden=!busy;$('workflow-sample').disabled=busy;
  inputIDs.forEach(id=>$('wf-'+id).disabled=busy||starting||demoMode||!canEdit());
  $('workflow-connection').textContent=demoMode?'架空のデータで体験中（外部AIへの送信なし）':aiSettings().serverReady?(aiConfigured()?'資料の取り扱いを確認済み':'資料の取り扱いを確認してください'):'制作を利用できるか確認してください';
  $('workflow-reconnect').disabled=busy||starting;
  $('workflow-action-hint').textContent=run?.status==='awaiting_transcript'?'文字起こしを追加して、執筆以降を再開できます。':run?.status==='awaiting_metrics'?'公開後の実績は企画・取材資料から追加できます。':'取材がまだでも、企画と取材準備から始められます。';
  let html='';
  for(const group of [...new Set(WORKFLOW_AGENTS.map(a=>a.group))]){
    const members=WORKFLOW_AGENTS.filter(a=>a.group===group),groupProgress=progress.stages.find(s=>s.group===group);
    const opened=members.some(a=>a.id===selected)||['running','waiting','attention'].includes(groupProgress.state);
    html+=`<details class="agent-group-panel" ${opened?'open':''}><summary><span>${esc(group)}</span><span>${groupProgress.done} / ${members.length}</span></summary>`;
    for(const agent of members){const item=agents.find(a=>a.id===agent.id),index=WORKFLOW_AGENTS.indexOf(agent);html+=`<button class="agent-row ${selected===agent.id?'selected':''}" data-agent="${agent.id}" aria-pressed="${selected===agent.id}"><span class="agent-index">${String(index+1).padStart(2,'0')}</span><span class="agent-name">${esc(agent.name.replace('エージェント',''))}<span class="agent-description">${esc(agent.description)}</span></span><span class="agent-status ${item.status}">${statusLabel[item.status]}</span></button>`;}
    html+='</details>';
  }
  $('agent-list').innerHTML=html;
  $('workflow-bundle').disabled=!run;
  $('workflow-wordpress').disabled=agentState(run||{agents:[]},'archive')?.status!=='done'||!run?.approvals.publication;
  $('workflow-approve-publication').disabled=!canApprove()||!run||!['awaiting_metrics','completed'].includes(run.status)||busy;
  $('approval-panel').hidden=run?.status!=='awaiting_review'&&approvalMode!=='publication';
  if(run?.status==='awaiting_review'){
    approvalMode='risk';$('approval-title').textContent=run.reviewScope==='public'?'タイトル・SNS文案を確認してください':'編集担当者の確認が必要です';$('approval-description').textContent=`原稿の確認候補：${run.finalFindings?.length||0}件／数字・表現の追加確認：${run.editorialChecks?.length||0}件／原文を確認できなかった指摘：${run.rejected}件。${run.reviewScope==='public'?'タイトルとSNS文案':'原稿'}を資料と照合し、判断理由を記録してください。`;$('approval-submit').textContent='判断を記録して再開';$('approval-submit').disabled=!canApprove();
  }
  $('workflow-review').disabled=agentState(run||{agents:[]},'final_check')?.status!=='done';
  renderArtifact();
  window.dispatchEvent(new Event('production:updated'));
}
function renderArtifact(){
  const agent=WORKFLOW_AGENTS.find(a=>a.id===selected),item=run&&agentState(run,selected);
  $('artifact-title').textContent=agent.name.replace('エージェント','');
  $('artifact-subtitle').textContent=agent.description;
  $('artifact-paragraph').disabled=busy||starting||!canEdit()||!['writing','rewrite'].includes(selected)||!item?.output?.article;
  $('artifact-import-word').disabled=$('artifact-paragraph').disabled;
  $('artifact-edit').disabled=busy||starting||!canEdit()||selected==='archive'||!editableFields(item?.output).length;
  $('artifact-regenerate').disabled=busy||starting||!canEdit()||!item?.output||run?.status==='budget_exceeded';
  $('artifact-download').disabled=!item?.output;$('artifact-copy').disabled=!item?.output;
  $('artifact-run').disabled=busy||starting||!canEdit()||item?.status==='done'||run?.status==='budget_exceeded';$('artifact-run').textContent=item?.status==='done'?'この作業は完了しています':'この作業まで進める';
  if(!item?.output){
    $('artifact-content').innerHTML=`<div class="artifact-empty"><span class="artifact-empty-icon" aria-hidden="true">▤</span><h3>${item?.status==='awaiting'?'必要な資料を待っています':item?.status==='running'?'内容を作成しています':item?.status==='failed'?'この工程で停止しました':'ここに作成した内容が表示されます'}</h3><p>${esc(item?.error||agent.description)}</p><p>${item?.status==='failed'?'完了済みの工程をやり直さず、続きから再開できます。':'企画・取材資料を入力して、記事の制作を始めてください。'}</p></div>`;return;
  }
  const out=selectedArtifact();
  let html='';
  if(out.summary)html+=`<div class="artifact-summary">${esc(out.summary)}</div>`;
  if(out.article)html+=`<h3>${esc(out.title)}</h3><div class="artifact-document">${esc(out.article)}</div>`;
  if(out.content){if(selected==='archive'){const draft=agentState(run,'rewrite').output;html+=`<p>入稿用ファイルを用意しました。内容を確認して保存できます。</p><h3>${esc(draft?.title||'原稿')}</h3><div class="artifact-document">${esc(draft?.article||'')}</div>`;}else html+=`<div class="artifact-document">${esc(out.content)}</div>`;}
  if(out.themes?.length)html+=`<h3>企画の切り口</h3><ul>${out.themes.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`;
  if(out.facts?.length)html+=`<h3>根拠を確認できた情報</h3>${out.facts.map(f=>`<div class="evidence"><strong>${esc(f.claim)}</strong><blockquote>${esc(f.evidence)}</blockquote><div class="source-context">${esc(f.source_id)}</div></div>`).join('')}`;
  if(out.gaps?.length)html+=`<h3>追加で確認すること</h3><ul>${out.gaps.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`;
  if(out.findings){
    html+=out.findings.length?out.findings.map(f=>`<div class="artifact-finding"><span class="badge">${esc(f.category)}</span><h3>${esc(f.title)}</h3><p>${esc(f.explanation)}</p><div class="quoted">${esc(f.quote)}</div><div class="evidence"><div class="evidence-label">根拠 ${esc(f.sourceId)}</div><blockquote>${esc(f.evidence)}</blockquote></div>${f.suggestion?`<h4>修正案</h4><p>${esc(f.suggestion)}</p>`:''}</div>`).join(''):'<p>確認候補は見つかりませんでした。公開前に、原稿と取材資料を編集者が最終確認してください。</p>';
    if(item.validated?.rejected)html+=`<div class="notice">${item.validated.rejected}件は根拠を検証できなかったため除外しました。</div>`;
  }
  if(['final_check','titles','social'].includes(selected)&&run?.editorialChecks?.length)html+=`<h3>公開前に資料で確認すること</h3>${run.editorialChecks.filter(c=>selected==='final_check'||c.title.startsWith('タイトル・SNS')).map(c=>`<div class="editorial-check"><strong>${esc(c.title)}</strong><p>${esc(c.description)}</p></div>`).join('')}`;
  if(out.items?.length)html+=`<h3>確認項目・次の作業</h3><ul>${out.items.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`;
  for(const [key,label] of [['titles','タイトル候補'],['headings','見出し'],['tags','タグ候補'],['categories','カテゴリ候補']])if(out[key]?.length)html+=`<h3>${label}</h3><ul>${out[key].map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`;
  if(out.posts?.length)html+=out.posts.map(p=>`<h3>${esc(p.platform)} 投稿下書き</h3><div class="artifact-document">${esc(p.text)}</div>`).join('');
  if(item.annotations?.length)html+=`<h3>検索で取得した参照先</h3><ul>${item.annotations.map(a=>`<li><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a></li>`).join('')}</ul><p>参照先の原文と、記事に使用する主張を確認してください。</p>`;
  $('artifact-content').innerHTML=html;
}
function download(content,type,name){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function selectedArtifact(){const out=run&&agentState(run,selected).output;if(selected==='archive'&&out){const article=agentState(run,'rewrite').output||agentState(run,'writing').output;return {...out,title:article?.title||run.input.topic,content:article?.article||''};}return out;}
export function initWorkflow(options={}){
  openReview=options.openReview||(()=>{});
  $('workflow-run').addEventListener('click',()=>void start());
  $('artifact-run').addEventListener('click',()=>void executeTask(selected));
  $('artifact-edit').addEventListener('click',()=>{
    if(busy||starting||!run||!canEdit())return;const currentRun=run,id=selected,original=structuredClone(agentState(run,id).output),fields=editableFields(original),dialog=$('artifact-edit-dialog');
    if(!fields.length||id==='archive')return;
    $('artifact-edit-fields').innerHTML=fields.map((f,i)=>`<label class="artifact-edit-label" for="artifact-edit-field-${i}">${esc(f.label)}</label><textarea id="artifact-edit-field-${i}" data-edit-field="${i}" maxlength="60000" rows="${['article','content'].includes(f.path[0])?14:3}">${esc(f.value)}</textarea>`).join('');$('artifact-edit-error').hidden=true;dialog.showModal();
    $('artifact-edit-save').onclick=async()=>{if(busy||starting||run!==currentRun)return;try{if(JSON.stringify(agentState(run,id).output)!==JSON.stringify(original))throw new Error('内容が変わりました。開き直してください。');const values=[...$('artifact-edit-fields').querySelectorAll('textarea')].map(t=>t.value);const changed=await saveArtifactEdit(run,id,editedOutput(original,values));dialog.close();approvalMode='risk';selected=id;render();status(changed?'変更を保存しました。「制作の続きを進める」で、校正や後の作業をやり直せます。':'内容は変更されていません。');}catch(e){$('artifact-edit-error').textContent=e.message;$('artifact-edit-error').hidden=false;}};
  });
  $('artifact-regenerate').addEventListener('click',async()=>{
    if(busy||starting||!run||!canEdit())return;if(!demoMode&&(!aiConfigured()||!aiSettings().consent)){status('資料の取り扱いを確認してから、作り直してください。');$('workflow-settings').click();return;}const id=selected;if(!confirm('この内容を作り直しますか？ この内容を使う後の工程と公開前の確認もやり直します。'))return;
    let backup;try{backup=await prepareRegeneration(run,id);approvalMode='risk';await start(id);if(['failed','cancelled','ready','budget_exceeded'].includes(run.status)){await restoreRegeneration(run,backup);selected=id;render();status('作り直しを完了できなかったため、前の内容を残しました。もう一度お試しください。',true);}}catch(e){if(backup)await restoreRegeneration(run,backup);render();status(e.message,true);}
  });
  $('workflow-reconnect').addEventListener('click',async()=>{if(busy||starting)return;starting=true;render();status('制作を利用できるか確認しています。');try{await discoverServer({verify:true});status(connectionMessage());}finally{starting=false;render();}});
  $('workflow-stop').addEventListener('click',()=>controller?.abort());
  $('workflow-preview').addEventListener('click',()=>{const settings=aiSettings(),input=readInput(),labels={topic:'企画テーマ',audience:'想定読者',goal:'記事の目的',media:'掲載媒体',targetLength:'文字数の目安',sources:'調査資料',rules:'編集ルール',transcript:'文字起こし',metrics:'公開後の実績'};let text=Object.entries(labels).map(([key,label])=>label+'\n'+(input[key]||'未入力')).join('\n\n');if(input.editorialContext)text+='\n\n参考記事（今回の事実根拠には使いません）\n'+input.editorialContext.references.map(r=>[r.title,r.date,r.url,[...r.industry,...r.themes].join(' / '),r.excerpt].join('\n')).join('\n\n')+'\n\n分類の名称\n'+input.editorialContext.categoryNames.join(' / ');$('privacy-preview').textContent=settings.redact?redactText(text,settings.terms):text;$('privacy-dialog').showModal();});
  $('workflow-clear').addEventListener('click',()=>{
    if(busy||starting){status('実行を停止してから資料を消去してください。',true);return;}
    if(!confirm('入力資料・成果物・資料の取り扱い設定を消去しますか？必要な記録は先に保存してください。'))return;
    demoMode=false;generatedSample=false;run=null;approvalMode='risk';inputIDs.filter(id=>!['media','length','web-search'].includes(id)).forEach(id=>$('wf-'+id).value='');$('privacy-preview').textContent='';$('approval-reason').value='';window.dispatchEvent(new Event('data:clear'));render();status('入力と成果物を消去しました。保存済みのファイルはお手元で管理してください。');
  });
  $('workflow-sample').addEventListener('click',()=>sample());
  $('workflow-generate').addEventListener('click',()=>{if(sample()){generatedSample=true;render();void start();}});
  $('workflow-demo').addEventListener('click',()=>{if(sample({demo:true})){status('架空のデータでデモを開始します。原稿の確認後、公開用データを確認し、架空の実績を追加してください。');void start();}});
  $('workflow-demo-exit').addEventListener('click',()=>$('workflow-clear').click());
  $('workflow-demo-metrics').addEventListener('click',async()=>{if(!run?.demo||busy)return;if(!await publicationApproved(run)){status('先に公開用データを確認してください。');return;}$('wf-metrics').value=DEMO_METRICS;void start();});
  $('agent-list').addEventListener('click',e=>{const b=e.target.closest('[data-agent]');if(b){selected=b.dataset.agent;render();}});
  $('workflow-bundle').addEventListener('click',()=>{if(run)download(JSON.stringify(exportRun(run),null,2),'application/json;charset=utf-8',`angle-production-${run.id}.json`);});
  $('workflow-wordpress').addEventListener('click',async()=>{const output=run&&agentState(run,'archive').output;if(!output)return;if(!await publicationApproved(run)){status('成果物が変更されています。公開用データの承認をやり直してください。',true);return;}await audit(run,'wordpress_package_exported',{approvalHash:run.approvals.publication.hash});download(output.content,'text/html;charset=utf-8','angle-wordpress-draft.html');});
  $('workflow-approve-publication').addEventListener('click',()=>{approvalMode='publication';$('approval-panel').hidden=false;$('approval-title').textContent='公開用データの承認';$('approval-description').textContent='修正稿・根拠・タイトル・SNS文案・画像の権利と未確認事項を確認してください。承認は現在の成果物に紐づきます。実際の公開・投稿はまだ行いません。';$('approval-submit').textContent='公開用データを承認';$('approval-submit').disabled=!canApprove();$('approval-reason').value='';$('approval-panel').scrollIntoView({behavior:'smooth',block:'center'});});
  $('approval-submit').addEventListener('click',async()=>{
    if(!run||busy||!canApprove())return;
    try{const reason=demoMode?redactText($('approval-reason').value.trim()):protectedInput($('approval-reason').value.trim());if(approvalMode==='risk'){await approveRisk(run,reason);$('approval-panel').hidden=true;await start(run.requestedTask||'all');}else{await approvePublication(run,reason);approvalMode='risk';$('approval-panel').hidden=true;render();status(demoMode?'デモの確認が完了しました。「架空の公開実績を追加して振り返る」で最後まで体験できます。実際の記事公開は行いません。':'内容の確認が完了しました。入稿用ファイルを保存し、担当者がWordPressなどで記事を公開してください。');}}catch(e){status(e.message,true);}
  });
  $('artifact-copy').addEventListener('click',async()=>{const out=selectedArtifact();if(!out)return;try{await navigator.clipboard.writeText(readableArtifact(out));status('内容をコピーしました。');}catch{const range=document.createRange();range.selectNodeContents($('artifact-content'));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);status('内容を選択しました。Ctrl／⌘＋Cでコピーできます。');}});
  $('artifact-download').addEventListener('click',()=>{const out=selectedArtifact();if(out)downloadText(readableArtifact(out),`記事の${WORKFLOW_AGENTS.find(a=>a.id===selected).name.replace('エージェント','')}.txt`);});
  $('project-stages').addEventListener('click',e=>{const button=e.target.closest('[data-progress-agent]');if(button){selected=button.dataset.progressAgent;render();$('artifact-title').scrollIntoView({behavior:'smooth',block:'center'});}});
  window.addEventListener('workspace:changed',()=>{render();if(pendingTarget!==null&&workspaceState().user){const target=pendingTarget;pendingTarget=null;queueMicrotask(()=>void start(target));}});
  window.addEventListener('materials:changed',render);
  window.addEventListener('knowledge:changed',render);
  $('workflow-review').addEventListener('click',()=>{if(run)openReview(run);});
  window.addEventListener('ai:configured',render);
  window.addEventListener('ai:configured',()=>{if(pendingTarget!==null&&aiConfigured()&&aiSettings().consent){const target=pendingTarget;pendingTarget=null;queueMicrotask(()=>void start(target));}});
  $('settings-dialog').addEventListener('close',()=>{if(!aiSettings().consent)pendingTarget=null;});
  window.addEventListener('data:clear',()=>pendingTarget=null);
  window.addEventListener('workflow:updated',()=>{approvalMode='risk';render();status('修正を反映しました。続きから再開し、原稿と公開用データをもう一度確認してください。');});
  window.addEventListener('beforeunload',e=>{if(run){e.preventDefault();e.returnValue='';}});
  render();
  const context=document.modelContext;
  if(context?.registerTool){
    const lifecycle=new AbortController();
    try{Promise.resolve(context.registerTool({name:'read_production_workflow',description:'制作フローの工程・進捗・成果物を読み取る。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>({status:run?.status||'ready',agents:(run?.agents||[]).map(({id,status,error,output})=>({id,status,error,output}))})},{signal:lifecycle.signal})).catch(()=>{});}catch{}
    window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  }
}
