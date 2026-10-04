import {agentState,publicationApproved} from './agents.js';
import {containsSecret,audit} from './security.js';
import {aiSettings} from './provider.js';
import {createDocx} from './docx.js';
export const TOOL_ADAPTERS=Object.freeze([
 {id:'word',name:'Word',kind:'file',label:'Wordファイルを保存',description:'編集できる原稿を.docx形式で保存します。',steps:'保存したファイルをWordで開き、編集・コメントできます。'},
 {id:'instagram',name:'Instagram',kind:'copy',platform:'Instagram',url:'https://www.instagram.com/',label:'キャプションをコピー',description:'確認済みのキャプションを投稿に使えます。',steps:'コピーした文案を投稿画面に貼り付け、画像と一緒に確認してください。'},
 {id:'youtube',name:'YouTube',kind:'copy',platform:'YouTube',url:'https://studio.youtube.com/',label:'タイトル・概要欄をコピー',description:'記事を紹介する動画のタイトル・概要欄の文案です。',steps:'YouTube Studioで動画を用意し、コピーした文案をタイトル・概要欄に貼り付けてください。'},
 {id:'canva',name:'Canva',kind:'file',url:'https://www.canva.com/',label:'デザイン用CSVを保存',description:'見出しとSNS文案をデザインの素材として渡せます。',steps:'Canvaの一括作成にCSVを読み込み、見出し・文案をデザインに割り当てます。画像・動画そのものは含みません。'},
 {id:'google-docs',name:'Google Docs',kind:'file',url:'https://docs.google.com/document/',label:'文書ファイルを保存',description:'チームで編集・コメントする原稿を渡せます。',steps:'保存したWordファイルをGoogle Driveにアップロードし、Google Docsで開いてください。'},
 {id:'wordpress',name:'WordPress',kind:'file',label:'入稿用HTMLを保存',description:'見出しと本文を入稿用ファイルにまとめます。',steps:'保存したHTMLを開き、WordPressのコードエディターへ内容を貼り付けて下書きを保存してください。'},
 {id:'x',name:'X',kind:'copy',platform:'X',url:'https://x.com/compose/post',label:'投稿文をコピー',description:'確認済みの短い投稿文を渡せます。',steps:'投稿画面で貼り付け、記事URLを差し替えて確認してください。'},
 {id:'linkedin',name:'LinkedIn',kind:'copy',platform:'LinkedIn',url:'https://www.linkedin.com/feed/',label:'投稿文をコピー',description:'ビジネス向けの紹介文を渡せます。',steps:'投稿画面で貼り付け、記事URLを差し替えて確認してください。'}
]);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function toolContent(run,id){
 const adapter=TOOL_ADAPTERS.find(t=>t.id===id);if(!adapter)throw new Error('対応するツールを選んでください。');
 const revision=run&&agentState(run,'rewrite').output;
 if(!revision?.article)throw new Error('記事の制作を進め、原稿を用意してください。');
 if(adapter.kind==='copy'){
  const post=agentState(run,'social').output?.posts?.find(p=>p.platform.toLowerCase()===adapter.platform.toLowerCase());
  if(!post?.text)throw new Error(`${adapter.name}の文案を用意してください。以前の成果物にない場合は、新しい制作でSNS文案を作成できます。`);
  return post.text;
 }
 if(id==='wordpress')return agentState(run,'archive').output?.content||'';
 if(id==='canva')return [revision.title,...(agentState(run,'titles').output?.titles||[]),...(agentState(run,'social').output?.posts||[]).map(p=>p.platform+'：'+p.text)].join('\n\n');
 return revision.title+'\n\n'+revision.article;
}
function csvCell(value){const s=String(value);return '"'+(/^[\s]*[=+\-@]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';}
export function toolFile(run,id){
 const content=toolContent(run,id);if(containsSecret(content))throw new Error('認証情報を含む資料は渡せません。');
 if(['word','google-docs'].includes(id)){const {title,article}=agentState(run,'rewrite').output;return {bytes:createDocx(title,article),type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',name:run.demo?'デモ原稿.docx':'記事原稿.docx'};}
 if(id==='wordpress')return {bytes:content,type:'text/html;charset=utf-8',name:run.demo?'デモ入稿.html':'記事入稿.html'};
 if(id==='canva'){const article=agentState(run,'rewrite').output,posts=agentState(run,'social').output?.posts||[];return {bytes:'\uFEFF'+[['記事タイトル','媒体','文案'],...posts.map(p=>[article.title,p.platform,p.text])].map(row=>row.map(csvCell).join(',')).join('\r\n'),type:'text/csv;charset=utf-8',name:run.demo?'デモデザイン文案.csv':'デザイン文案.csv'};}
 throw new Error('このツールは文案をコピーして使います。');
}
export async function ensureToolApproval(run,busy=false){
 if(busy)throw new Error('制作が完了してから内容を確認してください。');
 if(!run||!['awaiting_metrics','completed'].includes(run.status)||!await publicationApproved(run))throw new Error('先に記事プロジェクトの「公開用データを確認」で原稿とSNS文案を確認してください。');
 if(!run.demo&&aiSettings().classification==='restricted')throw new Error('外部送信禁止の資料はツールへ渡せません。');
}
function save(file){const url=URL.createObjectURL(new Blob([file.bytes],{type:file.type})),a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function renderIntegrations(container,{run,busy,onApproval}){
 const ready=!!run?.approvals?.publication&&!busy&&['awaiting_metrics','completed'].includes(run.status);
 container.innerHTML=`<h2>いつものツールへ渡す</h2><p class="card-note">原稿やSNS文案を確認して、ファイル保存・コピーで渡せます。各ツールのアカウントで開き、編集や投稿を行ってください。</p>${run?.demo?'<p class="notice">デモの文案です。実際の投稿には使わず、受け渡しの操作を体験してください。</p>':''}<p class="notice" id="tool-notice" role="status">${ready?'ツールを選んで、渡す内容を確認できます。':'原稿とSNS文案の確認後に使えます。'}</p><button class="button secondary" id="tools-approval">記事プロジェクトで内容を確認</button><div class="tool-grid">${TOOL_ADAPTERS.map(t=>{let exists=false;try{exists=!!toolContent(run,t.id);}catch{}return `<article class="dash-card tool-card"><h3>${esc(t.name)}</h3><p>${esc(t.description)}</p><button class="button secondary" data-tool="${t.id}" ${!ready||!exists?'disabled':''}>${esc(t.label)}</button><small>${esc(t.steps)}</small>${!exists&&ready?'<small>このツール用の文案はまだありません。</small>':''}${t.url?`<a href="${t.url}" target="_blank" rel="noopener noreferrer">${esc(t.name)}を開く ↗</a>`:''}</article>`;}).join('')}</div><p class="card-note">投稿・予約投稿やアカウントへの自動登録は行いません。画像・動画は各ツールで用意してください。</p>`;
 container.querySelector('#tools-approval').onclick=onApproval;
 container.querySelectorAll('[data-tool]').forEach(button=>button.onclick=async()=>{
  const notice=container.querySelector('#tool-notice'),adapter=TOOL_ADAPTERS.find(t=>t.id===button.dataset.tool),dialog=document.getElementById('tool-transfer-dialog'),preview=document.getElementById('tool-transfer-preview'),commit=document.getElementById('tool-transfer-confirm');
  try{await ensureToolApproval(run,busy);const content=toolContent(run,adapter.id);if(containsSecret(content))throw new Error('認証情報を含む資料は渡せません。');document.getElementById('tool-transfer-title').textContent=adapter.name+'へ渡す内容';preview.value=content;commit.textContent=adapter.label;dialog.showModal();
   commit.onclick=async()=>{try{await ensureToolApproval(run,busy);if(toolContent(run,adapter.id)!==content)throw new Error('原稿が変わりました。もう一度確認してください。');if(adapter.kind==='copy'){await navigator.clipboard.writeText(content);notice.textContent=adapter.name+'用の文案をコピーしました。各ツールで貼り付けてください。';}else{save(toolFile(run,adapter.id));notice.textContent=adapter.name+'用のファイルを保存しました。';}await audit(run,'tool_handoff',{tool:adapter.id,method:adapter.kind,simulated:!!run.demo});dialog.close();}catch(e){document.getElementById('tool-transfer-error').textContent=e.message||'操作を完了できませんでした。';}};
   document.getElementById('tool-transfer-error').textContent='';
  }catch(e){notice.textContent=e.message;}
 });
}
