import { protectData } from './security.js';
const config = { key:'', model:'openai/gpt-4.1-mini', reviewModel:'', researchModel:'',classification:'internal',redact:true,terms:'',consent:false,enabled:true };
let serverReady=false;
export function configureAI(next) {
  if(!next.preserveKey||String(next.key||'').trim())config.key = String(next.key || '').trim();
  for (const field of ['model','reviewModel','researchModel']) config[field] = String(next[field] || '').trim();
  if (!config.model) config.model = 'openai/gpt-4.1-mini';
  if(next.classification)config.classification=next.classification;
  if(typeof next.redact==='boolean')config.redact=next.redact;
  if(typeof next.consent==='boolean')config.consent=next.consent;
  if(typeof next.terms==='string')config.terms=next.terms;
  if(typeof next.enabled==='boolean')config.enabled=next.enabled;
}
export function aiConfigured() { return config.enabled&&(!!config.key||serverReady); }
export function aiSettings() { return { model:config.model,reviewModel:config.reviewModel,researchModel:config.researchModel,classification:config.classification,redact:config.redact,terms:config.terms,consent:config.consent,serverReady }; }
export function protectedInput(input){return protectData(input,config);}
export async function discoverServer(){try{const r=await fetch('/api/status',{cache:'no-store'});if(r.ok)serverReady=!!(await r.json()).configured;}catch{}window.dispatchEvent(new Event('ai:configured'));}
export function modelFor(role) { return (role==='review'?config.reviewModel:role==='research'?config.researchModel:'') || config.model; }
export async function callAgent({ id, role='generation', instruction, input, schema, signal, web=false, maxTokens=4500 }) {
  if (!aiConfigured()) throw new Error('AI接続設定にOpenRouterのAPIキーを入力してください。');
  input=protectedInput(input);
  if(web&&config.classification!=='public')throw new Error('Web検索は「公開情報」の資料だけで利用できます。社内限定の資料は検索へ送れません。');
  const chosenModel=modelFor(role);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort('timeout'),120000);
  const abort=()=>controller.abort('user');
  if(signal?.aborted)controller.abort('user');
  signal?.addEventListener('abort',abort,{once:true});
  let response;
  const body={agent:id,model:chosenModel,input,web};
  try {
    response=await fetch('/api/agents',{method:'POST',headers:{'Content-Type':'application/json','X-OpenRouter-Key':config.key,'X-Data-Classification':config.classification,'X-Data-Consent':config.consent?'confirmed':'','X-Redact-Pii':config.redact?'true':'false'},body:JSON.stringify(body),signal:controller.signal});
    if(!response.ok){
      const messages={400:'入力形式またはモデル設定を確認してください。',401:'ログイン状態とOpenRouterのAPIキーを確認してください。',402:'OpenRouterの残高が不足しています。',403:'アクセス権限・機密区分・送信同意を確認してください。',404:'指定したモデルが見つかりません。',408:'応答が時間内に届きませんでした。',413:'資料が大きすぎます。',422:'資料内の認証情報・個人情報、または根拠を確認してください。',429:'利用上限、または混雑状況を確認してください。',502:'モデルの提供元でエラーが発生しました。',503:'情報管理条件を満たすモデルの提供元がありません。'};
      throw new Error(`OpenRouterで実行できませんでした。${messages[response.status]||'しばらくしてから再開してください。'}（${response.status}）`);
    }
    const data=await response.json();
    if(data.error)throw new Error('モデルの提供元がエラーを返しました。別のモデルで再開できます。');
    const choice=data.choices?.[0];
    if(!choice||choice.finish_reason==='length')throw new Error('AIの出力が途中で終了しました。入力を短くするか、別のモデルで再開してください。');
    const raw=choice.message?.content;
    let output;
    try{output=JSON.parse(typeof raw==='string'?raw:'');}catch{throw new Error('AIの結果形式を読み取れませんでした。完了済みの作業は保持しています。');}
    validateSchema(output,schema);
    const annotations=(choice.message.annotations||[]).filter(a=>a?.type==='url_citation'&&/^https?:\/\//.test(a.url_citation?.url||'')).map(a=>({url:a.url_citation.url,title:String(a.url_citation.title||a.url_citation.url).slice(0,300),content:String(a.url_citation.content||'').slice(0,12000)}));
    const usage={model:data.model||chosenModel,promptTokens:Number(data.usage?.prompt_tokens)||0,completionTokens:Number(data.usage?.completion_tokens)||0,cost:typeof data.usage?.cost==='number'?data.usage.cost:null};
    return {output,annotations,usage};
  }catch(e){
    if(controller.signal.aborted){
      if(signal?.aborted){const error=new Error('実行を停止しました。完了済みの成果物は保持しています。');error.name='AbortError';throw error;}
      throw new Error('AIの応答が時間内に届きませんでした。完了済みの工程を残して再開できます。');
    }
    if(e instanceof TypeError)throw new Error('OpenRouterに接続できませんでした。通信環境を確認して再開してください。');
    throw e;
  }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}
export function validateSchema(value,schema,path='結果') {
  if(schema.type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${path}の形式が不正です。`);
    for(const key of schema.required||[])if(!(key in value))throw new Error(`${path}に必要な項目がありません。`);
    if(schema.additionalProperties===false&&Object.keys(value).some(k=>!Object.hasOwn(schema.properties||{},k)))throw new Error(`${path}に想定外の項目があります。`);
    for(const [key,item] of Object.entries(value))if(schema.properties?.[key])validateSchema(item,schema.properties[key],`${path}.${key}`);
  }else if(schema.type==='array'){
    if(!Array.isArray(value)||(schema.maxItems&&value.length>schema.maxItems))throw new Error(`${path}の項目数・形式が不正です。`);
    value.forEach(item=>validateSchema(item,schema.items,path));
  }else if(schema.type==='string'){
    if(typeof value!=='string'||value.length>60000||(schema.enum&&!schema.enum.includes(value)))throw new Error(`${path}の文字列が不正です。`);
  }
}
