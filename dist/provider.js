import {workspaceState,canEdit} from './workspace-client.js';
import { protectData } from './security.js';
const config = { model:'openai/gpt-4.1-mini', reviewModel:'', researchModel:'',classification:'internal',redact:true,terms:'',consent:false,enabled:false };
let serverReady=false;
let connection='checking',discovery=null;
const connectionMessages={checking:'制作を利用できるか確認しています。',missing_key:'制作の準備がまだ整っていません。運営者にお問い合わせください。入力した資料はそのまま保持しています。',invalid_key:'制作を利用できません。運営者にお問い合わせください。入力した資料はそのまま保持しています。',model_not_configured:'制作を利用できません。運営者にお問い合わせください。',credit_required:'制作サービスの利用枠を運営者に確認してください。',rate_limited:'制作サービスが混み合っています。少し待って、もう一度お試しください。',unreachable:'制作を利用できるか確認できませんでした。もう一度お試しください。',ready:'制作を利用できます。',not_checked:'制作の準備を確認しました。'};
export function connectionMessage(){return connectionMessages[connection]||connectionMessages.unreachable;}
export function configureAI(next) {
  for (const field of ['model','reviewModel','researchModel']) config[field] = String(next[field] || '').trim();
  if (!config.model) config.model = 'openai/gpt-4.1-mini';
  if(next.classification)config.classification=next.classification;
  if(typeof next.redact==='boolean')config.redact=next.redact;
  if(typeof next.consent==='boolean')config.consent=next.consent;
  if(typeof next.terms==='string')config.terms=next.terms;
  if(typeof next.enabled==='boolean')config.enabled=next.enabled;
}
export function aiConfigured() { return config.enabled&&serverReady; }
export function aiSettings() { return { model:config.model,reviewModel:config.reviewModel,researchModel:config.researchModel,classification:config.classification,redact:config.redact,terms:config.terms,consent:config.consent,serverReady,connection }; }
export function protectedInput(input){return protectData(input,config);}
export async function discoverServer({verify=false}={}){
  if(discovery){await discovery;return verify?discoverServer({verify:true}):{serverReady,connection};}
  discovery=(async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{const r=await fetch(verify?'/api/connection':'/api/status',{method:verify?'POST':'GET',cache:'no-store',signal:controller.signal});if(!r.ok)throw new Error('connection');const status=await r.json();serverReady=status.configured===true;connection=status.connection||(serverReady?'not_checked':'missing_key');if(typeof status.defaultModel==='string'&&status.defaultModel)config.model=status.defaultModel;}
    catch{serverReady=false;connection='unreachable';}finally{clearTimeout(timer);globalThis.window?.dispatchEvent(new Event('ai:configured'));}
    return {serverReady,connection};
  })();try{return await discovery;}finally{discovery=null;}
}
export function modelFor(role) { return (role==='review'?config.reviewModel:role==='research'?config.researchModel:'') || config.model; }
export async function callAgent({ id, role='generation', instruction, input, schema, signal, web=false, maxTokens=4500 }) {
  if(!canEdit())throw new Error('閲覧用の記事です。編集担当者に依頼してください。');
  if (!aiConfigured()) throw new Error('AI制作は現在利用できません。資料の取り扱いを確認し、改善しない場合は運営者にお問い合わせください。');
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
    response=await fetch('/api/agents',{method:'POST',headers:{'Content-Type':'application/json','X-Data-Classification':config.classification,'X-Data-Consent':config.consent?'confirmed':'','X-Redact-Pii':config.redact?'true':'false',...(workspaceState().current?.id?{'X-Project-Id':workspaceState().current.id}:{})},body:JSON.stringify(body),signal:controller.signal});
    if(!response.ok){
      let code='';try{code=(await response.json()).error;}catch{}
      const reasons={openrouter_key_required:'制作を利用できません。運営者にお問い合わせください。',provider_auth_failed:'制作サービスの認証を確認できませんでした。運営者に接続設定をご確認ください。',provider_credit_required:'制作サービスの利用枠を運営者に確認してください。',provider_policy_unavailable:'資料を安全に扱えることを確認できませんでした。資料は送信せず停止しました。運営者にお問い合わせください。',provider_model_unavailable:'指定された制作サービスを利用できません。運営者にお問い合わせください。',provider_route_unavailable:'この作業を現在利用できません。運営者にお問い合わせください。',provider_access_denied:'制作サービスの利用権限を運営者に確認してください。',provider_unavailable:'制作サービスを現在利用できません。時間をおいて再開してください。',provider_rate_limited:'制作サービスが混み合っています。少し待って、続きから再開してください。',provider_request_rejected:'資料を処理できませんでした。運営者にご確認ください。'};
      if(reasons[code])throw new Error(reasons[code]);
      const messages={400:'入力内容を確認してください。改善しない場合は運営者にお問い合わせください。',401:'AIの接続設定を運営者に確認してください。',402:'AIの利用枠を運営者に確認してください。',403:'アクセス権限・機密区分・送信同意を確認してください。',404:'記事の作成を利用できません。時間をおいてお試しください。',408:'応答が時間内に届きませんでした。',413:'資料が大きすぎます。',422:'資料内の認証情報・個人情報、または根拠を確認してください。',429:'利用上限、または混雑状況を確認してください。',502:'応答が届きませんでした。時間をおいて再開してください。',503:'資料の取り扱い条件を満たす接続先を現在利用できません。'};
      throw new Error(`作業を完了できませんでした。${messages[response.status]||'しばらくしてから再開してください。'}`);
    }
    const data=await response.json();
    if(data.error)throw new Error('応答を受け取れませんでした。時間をおいて再開してください。');
    const choice=data.choices?.[0];
    if(!choice||choice.finish_reason==='length')throw new Error('AIの出力が途中で終了しました。必要な資料に絞って、続きから再開してください。');
    const raw=choice.message?.content;
    let output;
    try{output=JSON.parse(typeof raw==='string'?raw:'');}catch{throw new Error('作成した内容を受け取れませんでした。完了済みの作業は保持しています。');}
    validateSchema(output,schema);
    const annotations=(choice.message.annotations||[]).filter(a=>a?.type==='url_citation'&&/^https?:\/\//.test(a.url_citation?.url||'')).map(a=>({url:a.url_citation.url,title:String(a.url_citation.title||a.url_citation.url).slice(0,300),content:String(a.url_citation.content||'').slice(0,12000)}));
    const usage={model:data.model||chosenModel,promptTokens:Number(data.usage?.prompt_tokens)||0,completionTokens:Number(data.usage?.completion_tokens)||0,cost:typeof data.usage?.cost==='number'?data.usage.cost:null};
    return {output,annotations,usage};
  }catch(e){
    if(controller.signal.aborted){
      if(signal?.aborted){const error=new Error('実行を停止しました。完了済みの成果物は保持しています。');error.name='AbortError';throw error;}
      throw new Error('AIの応答が時間内に届きませんでした。完了済みの工程を残して再開できます。');
    }
    if(e instanceof TypeError)throw new Error('AIに接続できませんでした。通信環境を確認して再開してください。');
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
