import {workflowSnapshot} from './workflow.js';
import {containsSecret} from './security.js';
import {readDocx} from './docx.js';
export const BRIEF_FIELDS={topic:300,audience:300,goal:500,media:100,targetLength:0,sources:20000,rules:15000,transcript:50000,metrics:10000,webSearch:0};
const media=['ビジネスメディア','オウンドメディア','インタビュー記事','その他'];
export function parseBrief(text){
  let data;try{data=JSON.parse(text);}catch{throw new Error('企画ファイルを読み取れませんでした。「入力内容を保存」で作成したファイルをご利用ください。');}
  if(!data||typeof data!=='object'||Array.isArray(data)||data.version!==1||!data.brief||typeof data.brief!=='object'||Array.isArray(data.brief)||Object.keys(data).some(k=>!['version','brief'].includes(k)))throw new Error('このファイルは企画ファイルではありません。入力用のひな形をご利用ください。');
  const brief=data.brief;
  if(Object.keys(brief).some(k=>!Object.hasOwn(BRIEF_FIELDS,k)))throw new Error('企画ファイルに対応していない項目があります。入力用のひな形をご利用ください。');
  for(const [key,value] of Object.entries(brief)){
    if(key==='targetLength'){if(!Number.isInteger(value)||value<300||value>8000)throw new Error('文字数の目安は300〜8,000文字にしてください。');}
    else if(key==='webSearch'){if(typeof value!=='boolean')throw new Error('企画ファイルの検索項目を読み取れませんでした。');}
    else if(typeof value!=='string'||value.length>BRIEF_FIELDS[key])throw new Error('資料が長すぎるか、入力形式が異なります。入力用のひな形をご利用ください。');
  }
  if(brief.media!==undefined&&!media.includes(brief.media))throw new Error('掲載媒体の項目を読み取れませんでした。');
  if(['sources','rules','transcript','metrics'].reduce((n,k)=>n+(brief[k]?.length||0),0)>80000)throw new Error('資料の合計は80,000文字以内で読み込んでください。');
  if(containsSecret(text))throw new Error('資料に認証情報が含まれているようです。取り除いてから読み込んでください。');
  return Object.fromEntries(Object.entries(brief));
}
export function validateMaterial(name,size,text,maxLength){
  if(!/\.(txt|md|csv)$/i.test(name))throw new Error('Word（.docx）、テキスト、CSVのファイルを選んでください。');
  if(size>500000)throw new Error('500KB以内のファイルをご利用ください。');
  if(typeof text!=='string'||text.includes('\u0000')||text.includes('\ufffd'))throw new Error('文章を読み取れませんでした。UTF-8のテキストファイルで保存し直してください。');
  if(text.length>maxLength)throw new Error(`この欄は${maxLength.toLocaleString()}文字まで読み込めます。`);
  if(containsSecret(text))throw new Error('資料に認証情報が含まれているようです。取り除いてから読み込んでください。');
  return text.replace(/^\ufeff/,'');
}
export function readableArtifact(output){
  if(!output)return '';
  const sections=[];if(output.title)sections.push(output.title);if(output.summary)sections.push(output.summary);if(output.article)sections.push(output.article);if(output.content)sections.push(output.content);
  for(const [key,title] of [['themes','企画の切り口'],['items','確認項目'],['gaps','追加で確認すること'],['titles','タイトル候補'],['headings','見出し'],['tags','タグ'],['categories','カテゴリ']])if(output[key]?.length)sections.push(title+'\n'+output[key].map(s=>'・'+s).join('\n'));
  if(output.facts?.length)sections.push('参考情報\n'+output.facts.map(f=>f.claim+'\n根拠：'+f.evidence+'\n資料：'+f.source_id).join('\n\n'));
  if(output.findings)sections.push(output.findings.length?'確認事項\n'+output.findings.map(f=>f.title+'\n'+f.explanation+'\n原稿：'+f.quote+'\n根拠：'+f.evidence+'\n修正案：'+(f.suggestion||'編集者が確認')).join('\n\n'):'確認候補は見つかりませんでした。公開前の最終確認は編集者が行ってください。');
  if(output.posts?.length)sections.push(output.posts.map(p=>p.platform+' 投稿案\n'+p.text).join('\n\n'));
  return sections.join('\n\n');
}
const $=id=>document.getElementById(id);let target=null,toastTimer;
function announce(message){const el=$('transfer-status');el.textContent=message;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,7000);}
export function downloadText(content,name,type='text/plain;charset=utf-8'){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function changed(input){input.dispatchEvent(new Event('input',{bubbles:true}));window.dispatchEvent(new Event('materials:changed'));}
function canEdit(input){return input&&!input.disabled&&!workflowSnapshot().busy;}
function replace(input,text){if(!canEdit(input))return;if(input.value.trim()&&input.value!==text&&!confirm('この欄の内容を置き換えますか？必要な内容は先に保存してください。'))return;input.value=text;changed(input);announce('文章を読み込みました。内容を確認してから制作を進めてください。');}
export function initTransfers(){
  for(const id of ['wf-sources','wf-rules','wf-transcript','wf-metrics','draft','transcript','rules']){
    const input=$(id),toolbar=document.createElement('div');toolbar.className='material-toolbar';toolbar.setAttribute('aria-label',id.startsWith('wf-')?input.closest('label').firstChild.textContent.trim()+'の操作':({draft:'初稿',transcript:'文字起こし',rules:'編集ルール'}[id])+'の操作');
    for(const [action,label] of [['upload','ファイルから読み込む'],['paste','貼り付け'],['copy','コピー'],['save','保存']]){const button=document.createElement('button');button.type='button';button.className='material-button';button.textContent=label;button.dataset.materialAction=action;button.dataset.materialTarget=id;toolbar.append(button);}input.after(toolbar);
    const note=document.createElement('small');note.className='material-format';note.textContent='Word・テキスト・CSVに対応。ファイルはこのページ内で読み込みます。';toolbar.after(note);
  }
  const stateUpdate=()=>{document.querySelectorAll('[data-material-target]').forEach(b=>{const disabled=$(b.dataset.materialTarget).disabled||workflowSnapshot().busy;if(b.disabled!==disabled)b.disabled=disabled;});for(const id of ['brief-import','brief-save','brief-template'])$(id).disabled=workflowSnapshot().busy;};
  window.addEventListener('production:updated',stateUpdate);new MutationObserver(stateUpdate).observe($('input-view'),{attributes:true,subtree:true,attributeFilter:['disabled']});
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-material-action]');if(!b)return;const input=$(b.dataset.materialTarget);if(!canEdit(input))return;
    try{
      if(b.dataset.materialAction==='upload'){target=input.id;$('material-file').value='';$('material-file').click();}
      if(b.dataset.materialAction==='paste'){let text;try{text=await navigator.clipboard.readText();}catch{input.focus();announce('入力欄にカーソルを置きました。右クリックの「貼り付け」またはCtrl／⌘＋Vで入力できます。');return;}if(!canEdit(input))return;validateMaterial('paste.txt',new TextEncoder().encode(text).length,text,input.maxLength);replace(input,text);}
      if(b.dataset.materialAction==='copy'){await navigator.clipboard.writeText(input.value);announce('コピーしました。');}
      if(b.dataset.materialAction==='save'){downloadText(input.value,({draft:'初稿',transcript:'文字起こし',rules:'編集ルール','wf-sources':'調査資料','wf-rules':'編集ルール','wf-transcript':'文字起こし','wf-metrics':'公開後の実績'}[input.id])+'.txt');announce('ファイルを保存しました。');}
    }catch(e){announce(e.message||'操作できませんでした。入力欄から直接コピーしてください。');}
  });
  $('material-file').addEventListener('change',async e=>{const file=e.target.files[0],input=$(target);if(!file||!canEdit(input))return;try{if(file.size>500000)throw new Error('500KB以内のファイルをご利用ください。');const word=/\.docx$/i.test(file.name);const text=validateMaterial(word?'word.txt':file.name,file.size,word?await readDocx(file):await file.text(),input.maxLength);replace(input,text);}catch(e){announce(e.message);}finally{$('material-file').value='';}});
  $('brief-import').addEventListener('click',()=>{if(workflowSnapshot().busy)return;$('brief-file').value='';$('brief-file').click();});
  $('brief-file').addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file||workflowSnapshot().busy)return;
    try{
      if(!/\.json$/i.test(file.name)||file.size>500000)throw new Error('500KB以内の企画ファイルを選んでください。');
      const brief=parseBrief(await file.text());if(workflowSnapshot().busy)return;
      if(workflowSnapshot().input.topic&&!confirm('現在の企画・取材資料を、ファイルの内容で置き換えますか？'))return;
      const ids={targetLength:'length',webSearch:'web-search'};
      for(const [key,limit] of Object.entries(BRIEF_FIELDS)){const input=$('wf-'+(ids[key]||key));if(key==='webSearch'){input.checked=false;continue;}input.value=brief[key]??(key==='targetLength'?1500:key==='media'?media[0]:'');changed(input);}
      $('brief-details').open=true;$('materials-details').open=!!(brief.sources||brief.rules||brief.transcript);$('metrics-details').open=!!brief.metrics;announce('企画・取材資料を読み込みました。資料の送信同意や承認をファイルから引き継ぐことはありません。');
    }catch(e){announce(e.message);}finally{$('brief-file').value='';}
  });
  $('brief-save').addEventListener('click',()=>{const input=workflowSnapshot().input,brief=Object.fromEntries(Object.keys(BRIEF_FIELDS).map(key=>[key,key==='webSearch'?false:input[key]]));downloadText(JSON.stringify({version:1,brief},null,2),'記事の企画・取材資料.json','application/json;charset=utf-8');announce('入力内容を保存しました。「企画ファイルを読み込む」で再利用できます。参考記事は記事資料として別に保存してください。');});
  $('brief-template').addEventListener('click',()=>{downloadText(JSON.stringify({version:1,brief:{topic:'',audience:'',goal:'',media:media[0],targetLength:1500,sources:'',rules:'',transcript:'',metrics:'',webSearch:false}},null,2),'企画入力のひな形.json','application/json;charset=utf-8');announce('入力用のひな形を保存しました。');});
  window.addEventListener('data:clear',()=>{target=null;$('material-file').value='';$('brief-file').value='';$('transfer-status').textContent='';$('transfer-status').hidden=true;clearTimeout(toastTimer);});stateUpdate();
}
