export const CLASSIFICATIONS=['public','internal','restricted'];
export function containsSecret(text){return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-or-v1-|sk-proj-|gh[pousr]_|github_pat_)[a-zA-Z0-9_-]{12,}|\bAKIA[A-Z0-9]{16}\b/.test(text);}
export function redactText(text,terms=''){
  let output=String(text);
  const custom=terms.split('\n').map(t=>t.trim()).filter(t=>t.length>=2).sort((a,b)=>b.length-a.length);
  custom.forEach((term,i)=>{output=output.split(term).join(`［非公開情報${i+1}］`);});
  output=output.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'［メールアドレス］');
  // Safari before iOS 16.4 cannot parse lookbehind, so the leading boundary is captured and kept.
  output=output.replace(/(^|\D)(?:\+81[-\s]?(?:0)?|0)(?:[789]0[-\s]?\d{4}[-\s]?\d{4}|\d{1,4}[-\s]\d{1,4}[-\s]\d{3,4})(?!\d)/g,(_,boundary)=>boundary+'［電話番号］');
  return output;
}
export function protectData(value,policy){
  if(policy.classification==='restricted')throw new Error('「機密・送信禁止」の資料は外部AIへ送信できません。基本チェックのみ利用できます。');
  if(!CLASSIFICATIONS.includes(policy.classification)||!policy.consent)throw new Error('情報管理設定で、資料を外部AIへ送信できることを確認してください。');
  const visit=v=>{
    if(typeof v==='string'){
      if(containsSecret(v))throw new Error('資料に、パスワードやアクセス用の鍵のような文字列が含まれています。その部分を削除してから、もう一度お試しください。');
      return policy.redact?redactText(v,policy.terms):v;
    }
    if(Array.isArray(v))return v.map(visit);
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x)]));
    return v;
  };
  return visit(value);
}
export async function digest(value){
  const bytes=new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
const auditQueues=new WeakMap();
export async function audit(run,event,detail={}){
  const next=(auditQueues.get(run)||Promise.resolve()).then(async()=>{
    run.audit ||= [];
    const entry={sequence:run.audit.length+1,time:new Date().toISOString(),event,detail,previousHash:run.audit.at(-1)?.hash||'0'.repeat(64)};
    entry.hash=await digest(entry);run.audit.push(entry);return entry;
  });
  auditQueues.set(run,next.catch(()=>{}));return next;
}
export async function verifyAudit(entries){
  let previous='0'.repeat(64);
  for(const [i,entry] of entries.entries()){
    const {hash,...body}=entry;
    if(entry.sequence!==i+1||entry.previousHash!==previous||await digest(body)!==hash)return false;
    previous=hash;
  }
  return true;
}
