import {importLibrary,searchLibrary,categorySuggestions,referenceContext} from './knowledge.js';
import {downloadText} from './transfers.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let library=null,selected=[],query='',message='',generation=0;
export function selectedKnowledge(){return referenceContext(library,selected);}
function changed(){globalThis.window?.dispatchEvent(new Event('knowledge:changed'));}
export function renderKnowledge(container,{busy=false,topic='',afterRender=()=>{}}={}){
  container.innerHTML=`<h2>過去記事から、次の企画へ</h2><p class="card-note">記事と分類をまとめて読み込み、似たテーマや別の切り口を探せます。読み込みだけでは外部へ送信しません。</p><div class="knowledge-actions"><button class="button primary" id="knowledge-import" ${busy?'disabled':''}>記事・CSVを読み込む</button><button class="button secondary" id="knowledge-save" ${library?'':'disabled'}>記事資料を保存</button><button class="button secondary" id="knowledge-clear" ${!library||busy?'disabled':''}>記事資料を消去</button><input id="knowledge-files" type="file" accept=".json,.csv,.txt,.md" multiple hidden></div><p class="card-note">元のCSV・本文を一緒に選択するか、保存した記事資料ファイルを1つ選択してください。資料はこのページ内で保持します。</p><p id="knowledge-message" class="notice" role="status">${esc(message||'閉じる前に必要な記事資料を保存してください。')}</p><div class="knowledge-stats">${[{value:library?.docs.length||0,label:'記事情報'},{value:library?.docs.filter(d=>d.body).length||0,label:'本文あり'},{value:library?.docs.filter(d=>!d.date).length||0,label:'公開日の確認待ち'}].map(s=>`<div><strong>${s.value}</strong><span>${s.label}</span></div>`).join('')}</div><label class="knowledge-search-label">過去記事を探す<input id="knowledge-search" maxlength="300" value="${esc(query||topic)}" placeholder="例：物流 DX、銀行 パスキー、外食 出店"></label><div id="knowledge-results"></div><details class="knowledge-help"><summary>取材と執筆で確認すること</summary><ul><li>読者の疑問に答える要点と、取り組みが成果につながる仕組み</li><li>数値の対象・期間・比較基準、企業の説明と確認済みの事実の区別</li><li>実績・計画・専門家の見解、導入条件と限界</li><li>金融・医療・法務の制度と時点、広告・告知の掲載区分</li></ul></details><button class="button secondary" data-open="brief">記事プロジェクトへ</button>`;
  const input=container.querySelector('#knowledge-search');if(!query&&topic)query=topic;
  const results=()=>{
    const matches=searchLibrary(library,query),suggestions=categorySuggestions(library,matches);
    container.querySelector('#knowledge-results').innerHTML=`<div class="knowledge-result-heading"><h3>${query?'このテーマに近い記事':'テーマを入力して記事を探す'}</h3><span>${selected.length} / 3本を選択</span></div>${suggestions.length?`<p class="card-note">分類の候補（参考記事から）：${suggestions.map(s=>`<span class="pill lavender">${esc(s)}</span>`).join(' ')}</p>`:''}<p class="card-note">参考記事は構成・切り口・分類に使います。今回の数字や発言は、今回の取材資料で確認します。選択した記事の冒頭600文字と記事情報が、制作時の送信確認に含まれます。</p>${matches.map(d=>`<article class="knowledge-result"><label><input type="checkbox" data-reference-id="${d.id}" ${selected.includes(d.id)?'checked':''} ${busy?'disabled':''}><span><strong>${esc(d.title)}</strong><small>${esc(d.date||'公開日未確認')} ・ ${d.body?'本文あり':'本文未登録'} ・ ${esc([...d.industry,...d.themes].join(' / '))}</small></span></label>${d.body?`<details><summary>本文を確認</summary><pre>${esc(d.body)}</pre></details>`:''}</article>`).join('')||'<p class="empty-text">記事資料を読み込み、企業名やテーマで検索してください。検索結果は企画の重複確認にも使えます。</p>'}${selected.length?`<h3>この制作に選択した参考記事</h3><ul>${library.docs.filter(d=>selected.includes(d.id)).map(d=>`<li>${esc(d.title)} <button class="button secondary" data-reference-remove="${d.id}" ${busy?'disabled':''}>選択を外す</button></li>`).join('')}</ul>`:''}`;
  };
  input.addEventListener('input',()=>{query=input.value;results();});results();
  container.querySelector('#knowledge-import').addEventListener('click',()=>container.querySelector('#knowledge-files').click());
  container.querySelector('#knowledge-files').addEventListener('change',async e=>{
    const current=++generation;try{
      const files=[...e.target.files];if(!files.length)return;if(files.length>500||files.reduce((s,f)=>s+f.size,0)>25000000)throw new Error('500ファイル・合計25MB以内で選んでください。');
      if(files.some(f=>!/\.json$/i.test(f.name)&&f.size>2000000))throw new Error('CSV・本文は1ファイル2MB以内で選んでください。');
      message='記事資料を整理しています。';container.querySelector('#knowledge-message').textContent=message;
      const data=[];for(const f of files)data.push({name:f.name,text:await f.text()});const next=importLibrary(data);if(current!==generation)return;
      library=next;selected=[];message=`${next.docs.length}件の記事情報と${next.docs.filter(d=>d.body).length}件の本文を読み込みました。${next.diagnostics.length?'分類やファイル名の違いを整理しました。':''}`;changed();renderKnowledge(container,{busy,topic,afterRender});
    }catch(error){if(current!==generation)return;message=error.message;container.querySelector('#knowledge-message').textContent=message;}finally{e.target.value='';}
  });
  container.querySelector('#knowledge-save').addEventListener('click',()=>{if(library)downloadText(JSON.stringify({version:1,docs:library.docs,industry:library.industry,themes:library.themes},null,2),'angle-article-library.json','application/json;charset=utf-8');});
  container.querySelector('#knowledge-clear').addEventListener('click',()=>{if(busy)return;generation++;library=null;selected=[];query='';message='このページの記事資料を消去しました。';changed();renderKnowledge(container,{busy,topic:'',afterRender});});
  container.querySelector('#knowledge-results').addEventListener('change',e=>{if(busy||!e.target.dataset.referenceId)return;const id=e.target.dataset.referenceId;if(e.target.checked&&selected.length>=3){e.target.checked=false;container.querySelector('#knowledge-message').textContent='この制作の参考記事は3本まで選択できます。';return;}selected=e.target.checked?[...selected,id]:selected.filter(v=>v!==id);changed();results();});
  container.querySelector('#knowledge-results').addEventListener('click',e=>{const id=e.target.closest('[data-reference-remove]')?.dataset.referenceRemove;if(id&&!busy){selected=selected.filter(v=>v!==id);changed();results();}});
  afterRender();
}
if(globalThis.window){
  window.addEventListener('data:clear',()=>{generation++;library=null;selected=[];query='';message='';changed();});
  window.addEventListener('beforeunload',e=>{if(library){e.preventDefault();e.returnValue='';}});
}
