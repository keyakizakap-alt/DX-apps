import {renderIntegrations} from './integrations.js';
import {workflowSnapshot,showWorkflow,openAgent,executeTask} from './workflow.js';
import {findTasks,isProductionRequest} from './tasks.js';
import {WORKFLOW_AGENTS} from './agents.js';
import {aiSettings,aiConfigured} from './provider.js';
import {nextAction,attentionItems} from './supervisor.js';
import {createNotificationCenter} from './notifications.js';
import {productionProgress} from './progress.js';
import {renderKnowledge} from './knowledge-ui.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const phaseLabels={ready:'準備中',task_completed:'作業完了',running:'進行中',awaiting_review:'確認待ち',awaiting_transcript:'取材待ち',awaiting_metrics:'公開準備完了',completed:'制作完了',cancelled:'停止中',failed:'要対応',budget_exceeded:'処理上限'};
const statusLabels={queued:'未着手',running:'進行中',done:'完了',awaiting:'入力待ち',failed:'要対応',cancelled:'停止'};
let section='dashboard',deadline='',notes='',query='',center,notifications=[],desktopEnabled=false;
const notificationsOpen=new Set();
const names={dashboard:'ダッシュボード',workflow:'記事プロジェクト',tasks:'マイタスク',calendar:'カレンダー',knowledge:'ナレッジ',templates:'テンプレート',team:'制作工程',editor:'原稿レビュー',integrations:'外部ツール'};
function navigate(name){
  section=name;window.scrollTo({top:0,behavior:'instant'});
  $('dashboard-view').hidden=name!=='dashboard';$('section-view').hidden=['dashboard','workflow','editor'].includes(name);
  if(!['workflow','editor'].includes(name))['workflow-view','input-view','result-view','steps-review'].forEach(id=>$(id).hidden=true);
  document.querySelectorAll('.sidebar>.nav-item').forEach(b=>b.classList.toggle('active',b.id==='nav-'+name));
  $('page-title').textContent=names[name]||'記事制作';
  $('page-description').textContent=name==='dashboard'?'企画から振り返りまで。制作サポートの仕事を、ひと目で。':'記事の進み具合と、必要な作業を確認できます。';
  if(name==='dashboard')render();
  else if(!['workflow','editor'].includes(name))renderSection();
}
function openAction(action){
  showWorkflow();
  if(action==='publication'&& !$('workflow-approve-publication').disabled){$('workflow-approve-publication').click();return;}
  if(action==='risk'){$('approval-panel').scrollIntoView({behavior:'smooth',block:'center'});$('approval-reason').focus();return;}
  if(action==='continue'){$('workflow-run').scrollIntoView({behavior:'smooth',block:'center'});return;}
  if(['brief','transcript','metrics'].includes(action)){$('brief-details').open=true;if(action==='transcript')$('materials-details').open=true;if(action==='metrics')$('metrics-details').open=true;const id={brief:'wf-topic',transcript:'wf-transcript',metrics:'wf-metrics'}[action];$(id).scrollIntoView({behavior:'smooth',block:'center'});$(id).focus();return;}
  const {run}=workflowSnapshot();const agent=run?.agents.find(a=>a.status===(action==='running'?'running':'failed'));
  if(agent)openAgent(agent.id);
}
function renderNotifications(records){
  notifications=records;
  const unread=records.filter(r=>!r.read&&r.active).length;
  $('notification-badge').hidden=!unread;$('notification-badge').textContent=unread;
  $('notification-bell').setAttribute('aria-label',`通知を開く（未読${unread}件）`);
  $('notification-list').innerHTML=records.length?records.map((r,i)=>`<button class="notification-item ${r.read?'read':''}" data-notice="${i}"><span class="pill ${r.active?'pink':'lavender'}">${r.active?'対応待ち':'対応済み'}</span><strong>${esc(r.title)}</strong><small>${new Date(r.time).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})} · ${r.read?'既読':'未読'}</small></button>`).join(''):'<p class="empty-text">通知はまだありません。</p>';
}
function delivery(record){
  if(!desktopEnabled||!('Notification' in window)||Notification.permission!=='granted')return;
  const n=new Notification('ANGLE Review：確認が必要です',{body:'記事制作が入力・確認待ちになりました。アプリで内容を確認してください。',tag:'angle-'+record.action});
  notificationsOpen.add(n);n.onclose=()=>notificationsOpen.delete(n);
  n.onclick=()=>{window.focus();center.read(record.key);if(center.records().some(r=>r.key===record.key&&r.active))openAction(record.action);else navigate('dashboard');n.close();};
}
async function enableNotifications(){
  const help=$('notification-help');
  if(!('Notification' in window)||!window.isSecureContext){help.textContent='この環境ではブラウザ通知を利用できません。画面内の通知を確認してください。';return;}
  try{
    const permission=await Notification.requestPermission();desktopEnabled=permission==='granted';
    help.textContent=desktopEnabled?'ブラウザ通知を有効にしました。このページが開いている間に通知します。本文・個人名は通知に載せません。':'ブラウザ通知は許可されていません。画面内の通知は引き続き利用できます。';
    $('enable-notifications').textContent=desktopEnabled?'ブラウザ通知を停止する':'ブラウザ通知を有効にする';
    // Notify existing unresolved items when opting in, without changing approvals.
    if(desktopEnabled){const pending=notifications.find(r=>r.active&&!r.read);if(pending)delivery(pending);}
  }catch{help.textContent='通知を有効にできませんでした。画面内の通知をご利用ください。';}
}
function agentRows(run,filter=''){
  return findTasks(filter,WORKFLOW_AGENTS).map(a=>{
    const state=run?.agents.find(s=>s.id===a.id);return `<div class="task-action-row"><button class="task-row" data-open-agent="${a.id}"><span class="agent-avatar ${state?.status==='done'?'mint':'violet'}">${esc(a.group.slice(0,1))}</span><span><strong>${esc(a.name.replace('エージェント',''))}</strong><small>${esc(a.description)}</small></span><span class="pill ${state?.status==='done'?'mint':'lavender'}">${statusLabels[state?.status||'queued']}</span></button><button class="button secondary" data-run-task="${a.id}" ${workflowSnapshot().busy||state?.status==='done'?'disabled':''}>ここまで進める</button></div>`;
  }).join('')||'<p class="empty-text">一致する工程はありません。</p>';
}
function renderSection(){
  const {run,input}=workflowSnapshot(),items=attentionItems(run),content=$('section-content');
  if(section==='integrations')renderIntegrations(content,{...workflowSnapshot(),onApproval:()=>openAction('publication')});
  if(section==='team')content.innerHTML=`<h2>記事の制作工程</h2><p class="card-note">事実・表記・構成は並行して照合。企画から順に進み、取材資料や原稿の確認が必要になったらお知らせします。</p><div class="task-list">${agentRows(run,query)}</div>`;
  if(section==='tasks')content.innerHTML=`<h2>今、対応すること</h2><p class="card-note">制作の状態に応じて更新される、編集者のタスクです。</p><label class="task-search-label">進めたい作業を探す<input id="task-search" type="search" maxlength="200" value="${esc(query)}" placeholder="例：質問を作って、SNSの投稿案、記事の制作を始める"></label><div id="task-search-results">${taskResults(run,items)}</div>`;
  if(section==='calendar')content.innerHTML=`<h2>公開予定</h2><p class="card-note">予定はこのページで管理します。公開やSNS投稿は自動実行しません。</p><label>公開予定日<input type="date" id="calendar-deadline" value="${esc(deadline)}"></label><div class="calendar-entry"><span class="pill lavender">${deadline?esc(deadline):'日付未設定'}</span><h3>${esc(input.topic||'新しい記事')}</h3><p>${esc(phaseLabels[run?.status]||'準備中')}</p><button class="button secondary" data-open="brief">企画・取材資料を開く</button></div>`;
  if(section==='knowledge')renderKnowledge(content,{busy:workflowSnapshot().busy,topic:input.topic,afterRender:()=>content.insertAdjacentHTML('beforeend',`<label class="knowledge-note-label">編集部のメモ<textarea id="knowledge-note" maxlength="10000" placeholder="媒体の知見、確認したいこと、次の記事へのメモ">${esc(notes)}</textarea></label><p class="card-note">このメモは外部へ送信しません。閉じる前に必要な内容をコピーして保存してください。</p>`)});
  if(section==='templates')content.innerHTML='<h2>記事の目的から始める</h2><p class="card-note">テーマや資料を上書きせず、未入力の読者・目的を補います。</p><div class="template-grid">'+[{id:'interview',title:'インタビュー記事',text:'発言の意図・条件を保ち、読者に知見を届ける。'},{id:'business',title:'業務改善の記事',text:'課題・取り組み・検証できる成果を整理する。'},{id:'owned',title:'オウンドメディア',text:'読者の悩みに答え、次の行動につなげる。'}].map(t=>`<button class="template-card" data-template="${t.id}"><span class="pill lavender">企画・取材資料</span><h3>${t.title}</h3><p>${t.text}</p><strong>この型で準備する →</strong></button>`).join('')+'</div>';
}
function taskResults(run,items){return `${!query||isProductionRequest(query)?`<div class="task-production-action"><strong>企画から記事の制作を進める</strong><p>資料を引き継いで順番に進めます。取材内容や確認が必要な場合はお知らせします。</p><button class="button primary" data-run-task="all" ${workflowSnapshot().busy?'disabled':''}>記事の制作を始める</button></div>`:''}${items.length?items.map(i=>`<button class="task-row" data-action-open="${i.action}"><span class="agent-avatar pink">!</span><span><strong>${esc(i.title)}</strong><small>${esc(i.description)}</small></span><span>›</span></button>`).join(''):''}<h3>作業を選んで進める</h3><p class="card-note">「ここまで進める」で、必要な前工程を含めて実行します。完了済みの作業は引き継ぎます。公開・送信は人が行います。</p><div class="task-list">${agentRows(run,query)}</div>`;}
function render(){
  const {run,input}=workflowSnapshot();const agents=run?.agents||[],done=agents.filter(a=>a.status==='done').length,running=agents.filter(a=>a.status==='running').length;
  const phase=phaseLabels[run?.status]||'準備中',items=attentionItems(run),settings=aiSettings();
  $('dashboard-title').textContent=input.topic||'次の記事を、ここから。';$('dashboard-phase').textContent=phase;
  $('dashboard-subtitle').textContent=input.goal||'テーマ・読者・目的を共有すると、企画から公開準備まで進めます。';
  $('article-preview-title').textContent=input.topic||'まだ企画がありません';$('article-preview-audience').textContent=input.audience||'企画の情報を入力しましょう';
  $('dashboard-media').textContent=input.media;$('dashboard-state').textContent=phase;$('dashboard-length').textContent=(input.targetLength||1500).toLocaleString()+'文字';
  $('dashboard-classification').textContent={internal:'社内限定・マスキング',public:'公開情報',restricted:'外部送信禁止'}[settings.classification];
  $('progress-count').innerHTML=`${done}<span>/ 17</span>`;$('progress-ring').setAttribute('stroke-dasharray',`${done/17*409} 409`);
  $('legend-done').textContent=done;$('legend-running').textContent=running;$('legend-waiting').textContent=17-done-running;
  $('production-done').textContent=done;$('production-pending').textContent=17-done;
  const groups=[...new Set(WORKFLOW_AGENTS.map(a=>a.group))];
  const progress=productionProgress(run);
  $('stage-timeline').innerHTML=progress.stages.map((stage,index)=>`<button class="stage ${stage.state}" data-open-agent="${stage.firstAgent}"><span class="stage-group group-${index}">${stage.group}</span><span class="stage-number">${stage.state==='done'?'✓':index+1}</span><small>${stage.label}</small></button>`).join('');
  $('production-bars').innerHTML=groups.map(g=>{const ids=WORKFLOW_AGENTS.filter(a=>a.group===g).map(a=>a.id),n=agents.filter(a=>ids.includes(a.id)&&a.status==='done').length;return `<div><svg viewBox="0 0 32 80" aria-label="${g} ${n}/${ids.length}工程完了"><rect x="5" y="4" width="22" height="72" rx="2" fill="#f2edf6"/><rect x="5" y="${76-n/ids.length*72}" width="22" height="${n/ids.length*72}" rx="2" fill="#ec8da3"/></svg><small>${g}</small></div>`;}).join('');
  const next=nextAction(run);$('next-action-title').textContent=next.title;$('next-action-reason').textContent=next.reason;$('next-action-button').textContent=next.label;
  $('approval-count').textContent=items.length+'件';$('dashboard-approvals').innerHTML=items.length?items.map(i=>`<button class="approval-item" data-action-open="${i.action}"><span class="approval-icon">!</span><span><strong>${esc(i.title)}</strong><small>${esc(i.description)}</small></span><span class="pill pink">対応待ち</span></button>`).join(''):'<p class="empty-text">今は対応待ちの項目はありません。</p>';$('dashboard-approval-open').disabled=!items.length;
  $('dashboard-quality').innerHTML=[['facts','内容・引用'],['style','表記・トーン'],['structure','構成・読みやすさ'],['final_check','最終の根拠照合'],['visuals','画像・権利の準備']].map(([id,label])=>{
    const a=agents.find(a=>a.id===id),count=(a?.output?.findings||[]).length;
    const text=a?.status==='done'?(id==='visuals'?'権利は人が確認':count?`要確認 ${count}件`:a.validated?.rejected?'根拠確認が必要':'検出なし'):statusLabels[a?.status||'queued'];
    return `<button class="quality-row" data-open-agent="${id}"><span>${label}</span><span class="pill ${a?.status==='done'&&!count&&!a?.validated?.rejected?'mint':count?'peach':'lavender'}">${esc(text)}</span></button>`;
  }).join('');
  const recent=(run?.audit||[]).filter(e=>['agent_completed','agent_interrupted','supervisor_required','supervisor_risk_approved','publication_package_approved'].includes(e.event)).slice(-4).reverse();
  $('dashboard-activity').innerHTML=recent.length?recent.map(e=>{const agent=WORKFLOW_AGENTS.find(a=>a.id===e.detail?.agent);return `<div class="activity-row"><span class="activity-icon ${e.event.includes('approved')?'mint':'lavender'}">${e.event==='agent_completed'?'✓':'·'}</span><div><strong>${esc(agent?.name||'編集者の確認')}</strong><p>${esc({agent_completed:'成果物を作成しました',agent_interrupted:'工程を停止しました',supervisor_required:'人の確認を待っています',supervisor_risk_approved:'判断を記録して再開しました',publication_package_approved:'公開用データを承認しました'}[e.event])}</p></div><small>${new Date(e.time).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</small></div>`;}).join(''):'<p class="empty-text">制作を開始すると、チームの動きがここに届きます。</p>';
  $('dashboard-team').innerHTML=WORKFLOW_AGENTS.filter(a=>['research','writing','final_check'].includes(a.id)).map(a=>`<button class="team-row" data-open-agent="${a.id}"><span class="agent-avatar lavender">${a.group.slice(0,1)}</span><span><strong>${a.name.replace('エージェント','')}</strong><small>${statusLabels[agents.find(s=>s.id===a.id)?.status||'queued']}</small></span></button>`).join('');
  center.update(run);
  if(!['dashboard','workflow','editor'].includes(section))renderSection();
}
export function initDashboard(){
  const icons={dashboard:'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',workflow:'M6 3h9l4 4v14H6ZM14 3v5h5M9 12h7M9 16h7',tasks:'M5 3h14v18H5ZM8 8l1 1 2-2M13 8h3M8 14l1 1 2-2M13 14h3',calendar:'M4 5h16v16H4ZM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2',knowledge:'M12 3 21 12 12 21 3 12ZM12 8v8M8 12h8',templates:'M5 3h14v18H5ZM8 8h8M8 12h8M8 16h5',team:'M7 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 21v-3a4 4 0 0 1 8 0v3M14 21v-3a4 4 0 0 1 8 0v3',editor:'m4 17 13-13 3 3-13 13-4 1ZM14 7l3 3',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M10 3h4l1 3 3 1 3 3v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3Z',sample:'M12 3 21 12 12 21 3 12ZM9 12h6M12 9v6'};
  for(const [name,path] of Object.entries(icons)){const button=$({settings:'settings-button',sample:'sample-nav'}[name]||'nav-'+name);button.querySelector('span').innerHTML=`<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;}

  center=createNotificationCenter({deliver:delivery,onChange:renderNotifications});
  window.addEventListener('workspace:navigate',e=>navigate(e.detail));
  ['dashboard','tasks','calendar','knowledge','templates','team','integrations'].forEach(name=>$('nav-'+name).addEventListener('click',()=>navigate(name)));
  $('nav-editor').addEventListener('click',()=>navigate('editor'));
  $('load-sample').addEventListener('click',()=>navigate('editor'));$('sample-nav').addEventListener('click',()=>navigate('editor'));
  document.addEventListener('click',e=>{
    const task=e.target.closest('[data-run-task]');if(task&&!task.disabled){void executeTask(task.dataset.runTask);return;}
    const agent=e.target.closest('[data-open-agent]');if(agent)openAgent(agent.dataset.openAgent);
    const sec=e.target.closest('[data-section]');if(sec)navigate(sec.dataset.section);
    const action=e.target.closest('[data-action-open]');if(action)openAction(action.dataset.actionOpen);
    const brief=e.target.closest('[data-open]');if(brief){if(brief.dataset.open==='quality')openAgent('final_check');else openAction('brief');}
    const template=e.target.closest('[data-template]');if(template){const presets={interview:['インタビュー記事','対象テーマに関心のある読者','取材の発言と条件を保ち、具体的な知見を伝える'],business:['ビジネスメディア','経営者と業務改善担当者','課題・取り組み・確認できる成果から実践のヒントを伝える'],owned:['オウンドメディア','自社のテーマに関心のある読者','読者の悩みに答え、次の行動につながる情報を伝える']};const values=presets[template.dataset.template];if(workflowSnapshot().busy)return;['media','audience','goal'].forEach((id,i)=>{if(id==='media'||!$('wf-'+id).value)$('wf-'+id).value=values[i];});openAction('brief');render();}
  });
  $('dashboard-open-project').addEventListener('click',()=>openAction('brief'));
  $('next-action-button').addEventListener('click',()=>openAction(nextAction(workflowSnapshot().run).kind));
  $('dashboard-approval-open').addEventListener('click',()=>{const item=attentionItems(workflowSnapshot().run)[0];if(item)openAction(item.action);});
  $('project-deadline').addEventListener('input',e=>{deadline=e.target.value;});
  $('section-content').addEventListener('input',e=>{if(e.target.id==='knowledge-note')notes=e.target.value;if(e.target.id==='calendar-deadline'){deadline=e.target.value;$('project-deadline').value=deadline;}});
  $('dashboard-search').addEventListener('input',e=>{query=e.target.value;navigate('tasks');});
  $('section-content').addEventListener('input',e=>{if(e.target.id==='task-search'){query=e.target.value;$('dashboard-search').value=query;$('task-search-results').innerHTML=taskResults(workflowSnapshot().run,attentionItems(workflowSnapshot().run));}});
  $('notification-bell').addEventListener('click',()=>{$('notification-dialog').showModal();});
  $('notification-list').addEventListener('click',e=>{const b=e.target.closest('[data-notice]');if(!b)return;const item=notifications[Number(b.dataset.notice)];center.read(item.key);$('notification-dialog').close();if(item.active)openAction(item.action);else navigate('dashboard');});
  $('enable-notifications').addEventListener('click',()=>{if(desktopEnabled){desktopEnabled=false;for(const n of notificationsOpen)n.close();$('enable-notifications').textContent='ブラウザ通知を有効にする';$('notification-help').textContent='ブラウザ通知を停止しました。画面内の通知をご利用ください。';}else void enableNotifications();});
  $('notification-enable-dialog').addEventListener('click',()=>void enableNotifications());
  window.addEventListener('production:updated',render);
  window.addEventListener('beforeunload',e=>{if(notes||deadline){e.preventDefault();e.returnValue='';}});
  window.addEventListener('data:clear',()=>{notes='';deadline='';query='';$('project-deadline').value='';$('dashboard-search').value='';center.clear();for(const n of notificationsOpen)n.close();notificationsOpen.clear();});
  document.querySelectorAll('.brief-fields input,.brief-fields textarea,.brief-fields select').forEach(el=>el.addEventListener('input',()=>{if(section==='dashboard')render();}));
  navigate('dashboard');render();
}
