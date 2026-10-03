import {containsSecret} from './security.js';
const MAX_DOCS=1500,MAX_CHARS=8000000;
export const normalizeTitle=s=>String(s).normalize('NFKC').replace(/\s+/g,' ').trim();
const alias=s=>normalizeTitle(s).replace(/[%/]/g,'_');
const split=s=>String(s||'').split(/[,/]/).map(v=>v.trim()).filter(Boolean);
const bounded=(v,max=300)=>{if(typeof v!=='string'||v.length>max||containsSecret(v))throw new Error('資料の形式または文字数を確認してください。');return v;};
export function cleanArticle(text){
  return text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/window\.googletag\s*=\s*window\.googletag\s*\|\|\s*\{cmd:\s*\[\]\};\s*googletag\.cmd\.push\(function\(\)\s*\{[\s\S]*?\}\);/g,'').replace(/\n{3,}/g,'\n\n').trim();
}
export function parseCSV(text){
  if(text.length>2000000)throw new Error('CSVは2MB以内で読み込んでください。');
  text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted)quoted=false;else if(cell==='')quoted=true;else throw new Error('CSVの引用符を確認してください。');}
    else if(!quoted&&(c===','||c==='\n'||c==='\r')){row.push(cell);cell='';if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(Boolean))rows.push(row);row=[];}}
    else cell+=c;
    if(cell.length>50000||row.length>30||rows.length>MAX_DOCS)throw new Error('CSVの行数・項目数・文字数を確認してください。');
  }
  if(quoted)throw new Error('CSVの引用符が閉じていません。');
  row.push(cell);if(row.some(Boolean))rows.push(row);if(!rows.length)throw new Error('CSVに項目がありません。');
  const headers=rows.shift().map(h=>h.trim());if(new Set(headers).size!==headers.length)throw new Error('CSVの見出しが重複しています。');
  return {headers,rows:rows.map(r=>{if(r.length!==headers.length)throw new Error('CSVの列数が揃っていません。');return Object.fromEntries(headers.map((h,i)=>[h,r[i]]));})};
}
function safeURL(s){if(!s)return '';try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}}
export function validateLibrary(raw){
  if(raw?.version!==1||!Array.isArray(raw.docs)||raw.docs.length>MAX_DOCS)throw new Error('対応している記事資料ファイルを選んでください。');
  let total=0;const seen=new Set(),taxonomy=(list=[])=>{if(!Array.isArray(list)||list.length>100)throw new Error('分類は100件以内にしてください。');const names=new Set();return list.map(t=>{const name=bounded(t.name,80);if(names.has(name))throw new Error('分類名が重複しています。');names.add(name);return {name,description:bounded(t.description||'',500),keywords:Array.isArray(t.keywords)?t.keywords.slice(0,40).map(k=>bounded(k,100)):[]};});};
  const library={version:1,docs:raw.docs.map((d,i)=>{
    const title=bounded(d.title),key=normalizeTitle(title);if(!key||seen.has(key))throw new Error('記事のタイトルが空欄または重複しています。');seen.add(key);
    const body=cleanArticle(bounded(d.body||'',50000));total+=body.length+title.length;if(total>MAX_CHARS)throw new Error('記事資料は合計800万文字以内にしてください。');
    const list=v=>{if(!Array.isArray(v)||v.length>40)throw new Error('記事の分類・タグを確認してください。');return v.map(x=>bounded(x,100));};
    const date=bounded(d.date||'',30);return {id:`article-${i+1}`,title,date:/^\d{4}[.\/-]\d{2}[.\/-]\d{2}$/.test(date)?date:'',url:safeURL(bounded(d.url||'',1000)),tags:list(d.tags||[]),industry:list(d.industry||[]),themes:list(d.themes||[]),body};
  }),industry:taxonomy(raw.industry),themes:taxonomy(raw.themes),diagnostics:[]};
  for(const field of ['industry','themes']){
    const names=new Set(library[field].map(t=>t.name)),unknown=new Set();for(const d of library.docs)for(const c of d[field])if(!names.has(c))unknown.add(c);
    if(unknown.has('その他')){library[field].push({name:'その他',description:'既存の記事分類に合わせた未分類の受け皿',keywords:[]});unknown.delete('その他');library.diagnostics.push(`${field==='industry'?'業界':'テーマ'}の「その他」を補いました。`);}
    for(const c of unknown)library.diagnostics.push(`分類マスターにない「${c}」は候補から外しています。`);
    const allowed=new Set(library[field].map(t=>t.name));library.docs.forEach(d=>d[field]=d[field].filter(c=>allowed.has(c)));
  }
  return library;
}
export function importLibrary(files){
  if(files.some(f=>/\.json$/i.test(f.name))){if(files.length!==1)throw new Error('記事資料ファイルは1つずつ選んでください。');return validateLibrary(JSON.parse(files[0].text));}
  const docs=new Map(),csvs=[],texts=[];const warnings=[];
  const get=title=>{const key=normalizeTitle(title);if(!docs.has(key))docs.set(key,{title:bounded(title),tags:[],industry:[],themes:[],body:''});return docs.get(key);};
  for(const file of files){if(/\.csv$/i.test(file.name))csvs.push({name:file.name,...parseCSV(file.text)});else if(/\.(txt|md)$/i.test(file.name))texts.push(file);else throw new Error('CSV・テキスト・記事資料ファイルを選んでください。');}
  const masters={industry:[],themes:[]};
  for(const csv of csvs){
    if(csv.headers.includes('title'))for(const r of csv.rows){const d=get(r.title);if(r.url!==undefined){if(d.url&&d.url!==r.url)throw new Error('同じタイトルに異なるURLがあります。');d.url=r.url;d.date=r.date;}if(r.tags!==undefined)d.tags=split(r.tags);if(r['業界']!==undefined)d.industry=split(r['業界']);if(r['テーマ']!==undefined)d.themes=split(r['テーマ']);}
    else if(csv.headers.includes('カテゴリ名')){const field=csv.name.normalize('NFC').includes('業界')?'industry':csv.name.normalize('NFC').includes('テーマ')?'themes':null;if(!field)throw new Error('分類マスターはファイル名に「業界」または「テーマ」を含めてください。');masters[field]=csv.rows.map(r=>({name:r['カテゴリ名'],description:r['説明']||'',keywords:split(r['主要キーワード'])}));}
    else throw new Error('CSVの見出しが記事情報・記事分類・分類マスターに対応していません。');
  }
  for(const file of texts){const title=file.name.replace(/\.(txt|md)$/i,''),key=normalizeTitle(title);let d=docs.get(key);if(!d){const matches=[...docs.values()].filter(d=>alias(d.title)===alias(title));if(matches.length===1){d=matches[0];warnings.push('ファイル名の記号の違いを照合しました。');}else if(matches.length>1)throw new Error('ファイル名に一致する記事が複数あります。');else d=get(title);}if(d.body)throw new Error('同じ記事の本文が重複しています。');d.body=file.text;}
  const library=validateLibrary({version:1,docs:[...docs.values()],...masters});library.diagnostics.push(...warnings);return library;
}
const stop=new Set(['なぜ','理由','企業','記事','する','ある','いる','とは','こと','日本','その','この']);
const indexes=new WeakMap();
function terms(text){const value=normalizeTitle(text).toLowerCase(),out=new Set();for(const m of value.matchAll(/[a-z0-9][a-z0-9.+-]*|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu)){const t=m[0];if(/^[a-z0-9]/.test(t)){if(t.length>=2)out.add(t);}else for(let i=0;i<t.length-1;i++){for(const size of [2,3])if(i+size<=t.length){const term=t.slice(i,i+size);if(!stop.has(term))out.add(term);}}}return out;}
export function searchLibrary(library,query,limit=8){
  if(!library||!query.trim())return [];const q=terms(query);if(!q.size)return [];let corpus=indexes.get(library);if(!corpus){corpus=library.docs.map(d=>({d,title:terms(d.title),tags:terms([...d.tags,...d.industry,...d.themes].join(' ')),body:terms(d.body)}));indexes.set(library,corpus);}
  const groups=normalizeTitle(query).toLowerCase().split(/\s+/);
  const df=new Map([...q].map(t=>[t,corpus.filter(r=>r.title.has(t)||r.tags.has(t)||r.body.has(t)).length]));
  const hits=corpus.map(r=>{let score=0,matched=0;for(const t of q){const weight=Math.log(1+(corpus.length+1)/(1+df.get(t)));const factor=r.title.has(t)?5:r.tags.has(t)?3:r.body.has(t)?1:0;if(factor){score+=weight*factor;matched++;}}const text=normalizeTitle([r.d.title,...r.d.tags,...r.d.industry,...r.d.themes,r.d.body].join(' ')).toLowerCase(),coverage=groups.filter(group=>text.includes(group)).length;if(normalizeTitle(r.d.title).toLowerCase()===normalizeTitle(query).toLowerCase())score+=10000;return {...r.d,score,matched,coverage};}).filter(r=>r.score>0&&r.coverage>0&&r.matched>=Math.min(2,q.size));
  const best=Math.max(0,...hits.map(r=>r.coverage));return hits.filter(r=>r.coverage===best).sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title,'ja')).slice(0,limit);
}
export function categorySuggestions(library,matches){
  if(!library)return [];const scores=new Map();for(const d of matches.slice(0,5))for(const name of [...d.industry,...d.themes])if(name!=='その他')scores.set(name,(scores.get(name)||0)+d.score);
  return [...scores].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name])=>name);
}
export function referenceContext(library,ids){
  if(!library||!ids.length)return undefined;const selected=library.docs.filter(d=>ids.includes(d.id)).slice(0,3);
  return {purpose:'切り口・構成・分類の参考。今回の事実根拠として使用しない。',categoryNames:[...new Set([...library.industry,...library.themes].map(c=>c.name))],references:selected.map(d=>({title:d.title,date:d.date||'時点未確認',url:d.url,industry:d.industry,themes:d.themes,excerpt:d.body.slice(0,600),hasBody:!!d.body}))};
}
