import {containsSecret} from '../dist/security.js';
const cookie='__Host-angle_access',refreshCookie='__Host-angle_refresh';
const response=(data,status=200,headers={})=>{const h=new Headers(headers);h.set('Cache-Control','no-store');h.set('X-Content-Type-Options','nosniff');return Response.json(data,{status,headers:h});};
export function workspaceConfigured(env){return /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(env.SUPABASE_URL||'')&&!!env.SUPABASE_PUBLISHABLE_KEY&&!!env.LOGIN_ALLOWED_EMAILS;}
export function allowedEmail(email,env){return typeof email==='string'&&email.length<254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&String(env.LOGIN_ALLOWED_EMAILS||'').toLowerCase().split(',').map(s=>s.trim()).some(s=>s.startsWith('@')?email.toLowerCase().endsWith(s):s===email.toLowerCase());}
function cookies(request){const result={};for(const part of (request.headers.get('Cookie')||'').split(';')){const i=part.indexOf('=');if(i>0)result[part.slice(0,i).trim()]=part.slice(i+1).trim();}return result;}
function setCookie(headers,name,value,age){headers.append('Set-Cookie',`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`);}
async function upstream(env,path,token,method='GET',body){const r=await fetch(env.SUPABASE_URL+path,{method,headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token||env.SUPABASE_PUBLISHABLE_KEY}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error'});let data;try{data=await r.json();}catch{data=null;}return {r,data};}
export async function workspaceSession(request,env){if(!workspaceConfigured(env))return null;const c=cookies(request);let token=c[cookie];if(!token)return null;const {r,data}=await upstream(env,'/auth/v1/user',token);if(!r.ok||!data?.email_confirmed_at||!allowedEmail(data.email,env))return null;return {token,user:{id:data.id,email:data.email}};}
export async function workspaceProjectRole(session,env,id){if(!session||!uuid(id))return null;const project=await upstream(env,`/rest/v1/angle_projects?id=eq.${id}&select=owner_id&limit=1`,session.token);if(!project.r.ok||!project.data?.[0])return null;if(project.data[0].owner_id===session.user.id)return 'owner';const members=await upstream(env,`/rest/v1/angle_members?project_id=eq.${id}&select=email,role`,session.token);return members.r.ok?members.data?.find(m=>m.email===session.user.email)?.role||null:null;}
async function boundedBody(request){const reader=request.body?.getReader();let n=0,parts=[];if(!reader)throw Error('invalid');while(true){const {value,done}=await reader.read();if(done)break;n+=value.length;if(n>1600000){await reader.cancel();throw Error('large');}parts.push(value);}const bytes=new Uint8Array(n);let i=0;for(const p of parts){bytes.set(p,i);i+=p.length;}return JSON.parse(new TextDecoder().decode(bytes));}
const uuid=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
const authRate=new Map();
export async function handleWorkspace(request,env){const url=new URL(request.url),path=url.pathname;if(!path.startsWith('/api/workspace')&&!path.startsWith('/api/auth'))return null;
 if(path==='/api/auth/status'){const session=await workspaceSession(request,env);return response({available:workspaceConfigured(env),user:session?.user||null});}
 if(!workspaceConfigured(env))return response({error:'workspace_unavailable'},503);
 if(!['GET','HEAD'].includes(request.method)&&(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site'))return response({error:'origin_denied'},403);
 try{
 if(path==='/api/auth/code'&&request.method==='POST'){const {email}=await boundedBody(request);if(!allowedEmail(email,env))return response({error:'email_not_allowed'},403);const k=email.toLowerCase(),previous=authRate.get(k)||0;if(Date.now()-previous<60000||authRate.size>1000)return response({error:'rate_limited'},429);authRate.set(k,Date.now());const {r}=await upstream(env,'/auth/v1/otp',null,'POST',{email:k,create_user:true});return response({sent:r.ok},r.ok?200:503);}
 if(path==='/api/auth/verify'&&request.method==='POST'){const {email,code}=await boundedBody(request);if(!allowedEmail(email,env)||typeof code!=='string'||!/^\d{6,8}$/.test(code))return response({error:'invalid_code'},400);const {r,data}=await upstream(env,'/auth/v1/verify',null,'POST',{email:email.toLowerCase(),token:code,type:'email'});if(!r.ok||!data?.access_token)return response({error:'invalid_code'},401);const h=new Headers();setCookie(h,cookie,data.access_token,Math.min(data.expires_in||3600,3600));setCookie(h,refreshCookie,data.refresh_token,7*86400);return response({user:{id:data.user.id,email:data.user.email}},200,h);}
 if(path==='/api/auth/refresh'&&request.method==='POST'){const token=cookies(request)[refreshCookie];if(!token)return response({error:'login_required'},401);const {r,data}=await upstream(env,'/auth/v1/token?grant_type=refresh_token',null,'POST',{refresh_token:token});if(!r.ok||!allowedEmail(data?.user?.email,env))return response({error:'login_required'},401);const h=new Headers();setCookie(h,cookie,data.access_token,Math.min(data.expires_in||3600,3600));setCookie(h,refreshCookie,data.refresh_token,7*86400);return response({user:{id:data.user.id,email:data.user.email}},200,h);}
 const session=await workspaceSession(request,env);if(!session)return response({error:'login_required'},401);
 if(path==='/api/auth/logout'&&request.method==='POST'){await upstream(env,'/auth/v1/logout',session.token,'POST');const h=new Headers();setCookie(h,cookie,'',0);setCookie(h,refreshCookie,'',0);return response({ok:true},200,h);}
 const db=async(p,method='GET',body)=>{const {r,data}=await upstream(env,'/rest/v1/'+p,session.token,method,body);if(!r.ok)return response({error:data?.code==='40001'?'save_conflict':data?.code==='42501'?'permission_denied':'save_failed'},data?.code==='40001'?409:403);return response(data);};
 if(path==='/api/workspace/projects'&&request.method==='GET')return db('angle_projects?select=id,title,details,revision,updated_at,expires_at,owner_id&order=updated_at.desc&limit=100');
 const id=url.searchParams.get('id');
 if(path==='/api/workspace/project'&&request.method==='GET'&&uuid(id))return db(`angle_projects?id=eq.${id}&select=*&limit=1`);
 if(path==='/api/workspace/versions'&&request.method==='GET'&&uuid(id))return db(`angle_versions?project_id=eq.${id}&select=id,revision,created_at,author_id&order=revision.desc&limit=30`);
 if(path==='/api/workspace/version'&&request.method==='GET'&&uuid(id))return db(`angle_versions?id=eq.${id}&select=*&limit=1`);
 if(path==='/api/workspace/members'&&request.method==='GET'&&uuid(id))return db(`angle_members?project_id=eq.${id}&select=email,role`);
 if(path==='/api/workspace/notices'&&request.method==='GET')return db('angle_notices?select=*&due_at=lte.'+encodeURIComponent(new Date().toISOString())+'&order=due_at.desc&limit=50');
 if(request.method==='POST'){
 const b=await boundedBody(request);
 if(path==='/api/workspace/save'){if(b.id!==null&&!uuid(b.id)||!Number.isInteger(b.revision)||!b.snapshot||!b.details||containsSecret(JSON.stringify(b)))return response({error:'invalid_material'},422);return db('rpc/angle_save_project','POST',{pid:b.id,expected_revision:b.revision,body:b.snapshot,info:b.details});}
 if(path==='/api/workspace/member'&&uuid(b.id)&&allowedEmail(b.email,env)&&['viewer','editor','approver'].includes(b.role))return db('rpc/angle_set_member','POST',{pid:b.id,member_email:b.email.toLowerCase(),member_role:b.role});
 if(path==='/api/workspace/delete'&&uuid(b.id))return db('rpc/angle_delete_project','POST',{pid:b.id});
 if(path==='/api/workspace/read'&&uuid(b.id))return db('rpc/angle_read_notice','POST',{nid:b.id});
 }
 return response({error:'not_found'},404);
 }catch{return response({error:'workspace_unavailable'},503);}
}
