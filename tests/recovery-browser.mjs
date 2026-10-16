import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright-core');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
try{
 const p=await browser.newPage(),errors=[];p.setDefaultTimeout(8000);p.on('pageerror',e=>errors.push(e.message));
 let failHistory=true;const id='11111111-1111-4111-8111-111111111111';
 await p.route('**/api/auth/status',r=>r.fulfill({json:{available:true,user:{id:'owner',email:'owner@company.test'}}}));
 await p.route('**/api/auth/logout',r=>r.fulfill({status:503,json:{error:'unavailable'}}));
 await p.route('**/api/workspace/**',r=>{const path=new URL(r.request().url()).pathname;if(path.endsWith('/save')){const body=r.request().postDataJSON();return r.fulfill({json:{...body,id,owner_id:'owner',revision:2,updated_at:new Date().toISOString()}});}if(path.endsWith('/versions')&&failHistory)return r.fulfill({status:503,json:{error:'unavailable'}});return r.fulfill({json:[]});});
 await p.goto(process.env.APP_TEST_URL||'http://127.0.0.1:4173/');await p.locator('#nav-workflow').click();
 await p.evaluate(async id=>(await import('/workspace-client.js')).setCurrentProject({id,owner_id:'owner',revision:1},'owner'),id);
 await p.locator('.project-management > summary').click();await p.locator('#history-open').click();
 await p.waitForTimeout(300);assert.equal(errors.length,0,'History network failure must be handled in the dialog');assert.match(await p.locator('#history-list').innerText(),/読み込|取得|通信/);
 failHistory=false;await p.locator('#history-retry').click();await p.waitForFunction(()=>document.getElementById('history-list').textContent.includes('履歴はまだありません'));
 await p.locator('#history-dialog [aria-label="閉じる"]').click();
 p.on('dialog',d=>d.accept().catch(()=>{}));await p.locator('#workspace-login').click();await p.waitForTimeout(300);assert.equal(errors.length,0,'Logout failure must not escape the click handler');await p.waitForFunction(()=>document.getElementById('notice').textContent.includes('ログアウトできません'));assert.equal(await p.locator('#notice').isVisible(),true);await p.evaluate(async()=>(await import('/workspace-client.js')).updateSaveState('保存しました'));assert.match(await p.locator('#notice').innerText(),/ログアウトできません/);assert.equal(await p.locator('#workspace-login').innerText(),'ログアウト');
 // Cancel opening another article: retain both the input and the chooser.
 await p.evaluate(async()=>{(await import('/workspace-client.js')).setCurrentProject(null);});
 const project={id,owner_id:'owner',title:'保存済みの記事',revision:1,updated_at:new Date().toISOString(),details:{},snapshot:{version:1,input:{topic:'保存済みの記事',audience:'読者',goal:'目的',media:'ビジネスメディア',targetLength:1500,sources:'',rules:'',transcript:'',metrics:'',webSearch:false},run:null}};
 await p.route('**/api/workspace/**',r=>{const path=new URL(r.request().url()).pathname;return r.fulfill({json:path.endsWith('/projects')||path.endsWith('/project')?[project]:[]});});
 await p.locator('#wf-topic').fill('保存していない記事');await p.locator('#projects-open').click();p.removeAllListeners('dialog');p.on('dialog',d=>d.dismiss().catch(()=>{}));await p.locator('[data-project-id]').click();assert.equal(await p.locator('#projects-dialog').isVisible(),true);assert.equal(await p.locator('#wf-topic').inputValue(),'保存していない記事');assert.deepEqual(errors,[]);
 await p.route('**/api/workspace/notices',r=>r.fulfill({json:[{id:'notice-1',project_id:id,kind:'review',read_at:null}]}));await p.route('**/api/workspace/project?**',r=>r.fulfill({status:403,json:{error:'permission_denied'}}));await p.evaluate(()=>window.dispatchEvent(new Event('workspace:changed')));await p.locator('[data-saved-notice]').click();await p.waitForFunction(()=>document.getElementById('projects-message').textContent.includes('権限'));assert.deepEqual(errors,[]);
 await p.close();const offline=await browser.newPage();await offline.route('**/api/auth/status',r=>r.fulfill({json:{available:false,user:null}}));await offline.goto(process.env.APP_TEST_URL||'http://127.0.0.1:4173/');await offline.locator('#nav-workflow').click();await offline.locator('#projects-open').click();assert.match(await offline.locator('#project-list').innerText(),/共有保存をまだ利用できません/);assert.equal(await offline.locator('#workspace-login').isVisible(),false);
 console.log('Recovery verified: failed history loading can retry, failed logout preserves session, canceling project selection preserves inputs and chooser.');
}finally{await browser.close();}
