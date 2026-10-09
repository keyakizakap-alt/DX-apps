import {workspaceState,canEdit} from './workspace-client.js';
import { protectData } from './security.js';
const config = { model:'openai/gpt-4.1-mini', reviewModel:'', researchModel:'',classification:'internal',redact:true,terms:'',consent:false,enabled:false };
let serverReady=false;
let connection='checking',discovery=null;
const connectionMessages={checking:'制作を利用できるか確認しています。',missing_key:'現在、AIによる記事作成の準備中のため利用できません。入力した内容はそのまま残っています。運営者にお問い合わせください。（コード：S01）',invalid_key:'現在、AIによる記事作成を利用できません。入力した内容はそのまま残っています。運営者にお問い合わせください。（コード：S02）',model_not_configured:'現在、AIによる記事作成を利用できません。入力した内容はそのまま残っています。運営者にお問い合わせください。（コード：S03）',credit_required:'AIの利用できる上限に達したため、記事作成を始められません。入力した内容はそのまま残っています。運営者にお問い合わせください。（コード：S04）',rate_limited:'ただいまAIが混み合っています。1〜2分ほど待ってから、もう一度お試しください。',provider_auth_failed:'現在、AIによる記事作成を利用できません。入力した内容はそのまま残っています。運営者にお問い合わせください。（コード：S05）',provider_credit_required:'AIの利用できる上限に達したため、記事作成を始められません。入力した内容はそのまま残っています。運営者にお問い合わせください。（コード：S04）',provider_policy_unavailable:'資料を安全に送れるAIが見つからないため、記事作成を始められません。入力した内容はそのまま残っています。運営者にお問い合わせください。（コード：S06）',provider_model_unavailable:'記事作成に使うAIが一時的に利用できません。しばらく待ってから、もう一度お試しください。続く場合は運営者にお問い合わせください。（コード：S07）',provider_route_unavailable:'記事作成に使うAIが一時的に利用できません。しばらく待ってから、もう一度お試しください。続く場合は運営者にお問い合わせください。（コード：S08）',provider_access_denied:'現在、AIによる記事作成を利用できません。入力した内容はそのまま残っています。運営者にお問い合わせください。（コード：S09）',provider_request_rejected:'現在、AIによる記事作成を利用できません。入力した内容はそのまま残っています。運営者にお問い合わせください。（コード：S10）',provider_unavailable:'AIにつながりませんでした。しばらく待ってから、もう一度お試しください。',provider_rate_limited:'ただいまAIが混み合っています。1〜2分ほど待ってから、もう一度お試しください。',unreachable:'AIが使えるか確認できませんでした。インターネットの接続を確認して、もう一度お試しください。',ready:'制作を利用できます。',not_checked:'制作の準備を確認しました。'};
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
  discovery=(async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),verify?45000:12000);
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
      const reasons={openrouter_key_required:'現在、AIによる記事作成を利用できません。運営者にお問い合わせください。（コード：S01）',provider_auth_failed:'現在、AIによる記事作成を利用できません。運営者にお問い合わせください。（コード：S05）',provider_credit_required:'AIの利用できる上限に達したため、作業を止めました。運営者が上限を確認した後に再開できます。（コード：S04）',provider_policy_unavailable:'資料を安全に送れるAIが見つからなかったため、資料を送らずに止めました。運営者にお問い合わせください。（コード：S06）',provider_model_unavailable:'この作業に使うAIが一時的に利用できません。しばらく待ってから「続きから再開」してください。続く場合は運営者にお問い合わせください。（コード：S07）',provider_route_unavailable:'この作業に使うAIが一時的に利用できません。しばらく待ってから「続きから再開」してください。続く場合は運営者にお問い合わせください。（コード：S08）',provider_access_denied:'現在、AIによる記事作成を利用できません。運営者にお問い合わせください。（コード：S09）',provider_unavailable:'AIにつながりませんでした。しばらく待ってから「続きから再開」してください。',provider_rate_limited:'ただいまAIが混み合っています。1〜2分ほど待ってから「続きから再開」してください。',provider_request_rejected:'AIがこの資料を処理できませんでした。資料を必要な部分に絞ってから再開してください。続く場合は運営者にお問い合わせください。（コード：S10）'};
      if(reasons[code]){const error=new Error(reasons[code]);error.retryable=code==='provider_unavailable'&&[502,503].includes(response.status);throw error;}
      if(code==='upstream_unavailable'){const error=new Error('制作サービスへの接続を確認しています。');error.retryable=true;throw error;}
      const messages={400:'入力内容を見直して、もう一度お試しください。続く場合は運営者にお問い合わせください。',401:'現在、AIを利用できません。運営者にお問い合わせください。（コード：S02）',402:'AIの利用できる上限に達しました。運営者にお問い合わせください。（コード：S04）',403:'「資料の取り扱い」の設定（資料の区分・送信の同意）を確認してください。',404:'いまこの作業を利用できません。しばらく待ってから、もう一度お試しください。',408:'AIの応答に時間がかかりすぎました。「続きから再開」してください。',413:'資料の量が多すぎます。資料を減らしてから再開してください。',422:'資料に、パスワードなどの秘密の情報や個人情報が含まれている可能性があります。その部分を削除してから再開してください。',429:'ただいま混み合っているか、利用回数の上限に達しました。少し待ってから再開してください。',502:'AIから応答がありませんでした。しばらく待ってから再開してください。',503:'いまAIを利用できません。しばらく待ってから再開してください。'};
      throw new Error(`作業を完了できませんでした。${messages[response.status]||'しばらくしてから再開してください。'}`);
    }
    const data=await response.json();
    if(data.error)throw new Error('応答を受け取れませんでした。時間をおいて再開してください。');
    const choice=data.choices?.[0];
    if(!choice||choice.finish_reason==='length')throw new Error('AIの回答が長くなりすぎて途中で止まりました。資料を必要な部分に絞ってから、続きから再開してください。');
    const raw=choice.message?.content;
    let output;
    try{output=JSON.parse(typeof raw==='string'?raw:'');}catch{throw new Error('作成した内容を受け取れませんでした。完了済みの作業は保持しています。');}
    try{validateSchema(output,schema);}catch{throw new Error('AIの回答をうまく受け取れませんでした。完了した作業は残っています。「続きから再開」をお試しください。');}
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
