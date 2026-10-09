import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright-core');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
try{
 const p=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),calls=[],errors=[];let failInvitation=true;p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
 await p.route('**/api/auth/status',r=>r.fulfill({json:{available:false,user:null}}));await p.route('**/api/{status,connection}',r=>r.fulfill({json:{configured:true,connection:'ready',defaultModel:'openai/gpt-4.1-mini'}}));
 await p.route('**/api/agents',r=>{const {agent:id}=r.request().postDataJSON();calls.push(id);if(id==='coordination'&&failInvitation)return r.fulfill({status:503,json:{error:'provider_unavailable'}});const output=['facts','style','structure','final_check'].includes(id)?{findings:[]}:['writing','rewrite'].includes(id)?{summary:'取材から作成',title:'作業の改善',article:'取材先では確認項目を一覧にまとめています。'}:id==='research'?{summary:'調査',themes:['改善'],facts:[],gaps:[]}:id==='titles'?{summary:'見出し',titles:['作業の改善'],headings:['取り組み'],tags:['改善'],categories:['ビジネス']}:id==='social'?{summary:'紹介文',posts:[{platform:'Instagram',text:'確認項目を一覧にまとめる取り組み。'}]}:{summary:'内容を準備しました',content:'確認することをまとめました。',items:['取材先に確認する']};return r.fulfill({json:{choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}});});
 await p.goto(process.env.APP_TEST_URL||'http://127.0.0.1:4173/');await p.locator('#nav-workflow').click();assert.equal(await p.locator('#artifact-edit').isVisible(),false);
 const startBox=await p.locator('#workflow-run').boundingBox();await p.screenshot({path:'/tmp/angle-ux-desktop.png',fullPage:true});assert.ok(startBox.y<1000,JSON.stringify(startBox));
 await p.screenshot({path:'/tmp/angle-ux-desktop.png',fullPage:true});
 await p.setViewportSize({width:390,height:844});
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const mobileBox=await p.locator('#workflow-run').boundingBox();assert.ok(mobileBox.y+mobileBox.height<=844&&mobileBox.y>700);
 await p.screenshot({path:'/tmp/angle-ux-mobile.png',fullPage:true});
 await p.setViewportSize({width:1440,height:1000});
 await p.locator('#wf-topic').fill('確認作業の改善');await p.locator('#wf-audience').fill('編集担当者');await p.locator('#wf-goal').fill('取り組みを紹介する');await p.locator('#workflow-run').click();await p.locator('#data-consent').check();await p.getByRole('button',{name:'設定を適用',exact:true}).click();await p.waitForFunction(()=>document.getElementById('workflow-phase').textContent==='取材待ち');
 assert.equal(calls.length,5);assert.equal(await p.locator('#artifact-title').textContent(),'取材内容を整理');assert.ok((await p.locator('#artifact-content').textContent()).includes('取材メモ'));assert.ok((await p.locator('[data-agent="coordination"]').textContent()).includes('取材相手・依頼メール'));assert.ok((await p.locator('[data-agent="coordination"]').textContent()).includes('作り直せます'));
 assert.equal(await p.locator('#workflow-run').textContent(),'取材メモを追加する');
 await p.locator('#workflow-run').click();assert.equal(await p.locator('#wf-transcript').evaluate(el=>document.activeElement===el),true);
 await p.locator('#wf-transcript').fill('取材先では確認項目を一覧にまとめています。');await p.locator('#workflow-run').click();await p.waitForFunction(()=>document.getElementById('workflow-phase').textContent==='実績待ち');assert.ok(calls.includes('writing'));assert.ok((await p.locator('#artifact-content').textContent()).includes('取材先では確認項目'));assert.equal(await p.locator('#workflow-wordpress').isEnabled(),false);
 await p.locator('.agent-group-panel').filter({has:p.locator('[data-agent="writing"]')}).locator('summary').click();await p.locator('[data-agent="writing"]').click();
 assert.equal(await p.locator('#artifact-edit').isVisible(),true);
 await p.locator('#artifact-edit').click();await p.locator('#artifact-edit-field-2').fill('取材先では確認項目を一覧にまとめています。担当者が確認します。');
 await p.locator('#artifact-edit-save').click();assert.ok((await p.locator('#artifact-content').textContent()).includes('担当者が確認します'));
 await p.locator('.artifact-tools details').filter({has:p.locator('#artifact-download')}).locator('summary').click();
 const downloaded=p.waitForEvent('download');await p.locator('#artifact-download').click();assert.ok((await downloaded).suggestedFilename());
 await p.screenshot({path:'/tmp/angle-ux-generated.png',fullPage:true});
 failInvitation=false;await p.locator('[data-agent="coordination"]').click();await p.locator('#artifact-run').click();await p.waitForFunction(()=>document.getElementById('workflow-phase').textContent==='作業完了');assert.equal(calls.filter(id=>id==='writing').length,1);assert.equal(calls.filter(id=>id==='research').length,1);assert.deepEqual(errors,[]);console.log('Preparation verified: invitation failure is visible, interview wait explains next input, supplied interview reaches writing, independent retry preserves manuscript and approvals.');
}finally{await browser.close();}
