import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)('playwright-core');
const raw=process.env.ANGLE_LIBRARY_PATH?await fs.readFile(process.env.ANGLE_LIBRARY_PATH,'utf8'):JSON.stringify({version:1,industry:[],themes:[],docs:[{title:'銀行のパスキー認証',body:'銀行の認証にパスキーを使う。',date:'2025.10.01'},{title:'物流の取り組み',body:'配送を改善する。'},{title:'外食の出店',date:'2025.10.02'}]}),data=JSON.parse(raw);
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});const page=await context.newPage(),errors=[],csp=[];let calls=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.on('console',m=>{if(m.text().includes('Content Security Policy'))csp.push(m.text());});await page.route('**/api/agents',r=>{calls++;return r.abort();});
 await page.goto('http://127.0.0.1:4173/');await page.locator('#nav-knowledge').click();await page.locator('#knowledge-files').setInputFiles({name:'記事資料.json',mimeType:'application/json',buffer:Buffer.from(raw)});await page.waitForFunction(n=>document.getElementById('knowledge-message').textContent.includes(n+'件'),data.docs.length);
 assert.equal(await page.locator('.knowledge-stats strong').nth(1).textContent(),String(data.docs.filter(d=>d.body).length));assert.equal(await page.locator('.knowledge-stats strong').nth(2).textContent(),String(data.docs.filter(d=>!d.date).length));
 await page.locator('#knowledge-search').fill('銀行 パスキー');await page.locator('.knowledge-result').first().waitFor();const selectedTitle=await page.locator('.knowledge-result').first().locator('strong').textContent();assert.ok((await page.locator('.knowledge-result').first().textContent()).includes('パスキー'));assert.ok(!(await page.locator('.knowledge-result').first().textContent()).includes('window.googletag'));
 await page.locator('[data-reference-id]').first().check();await page.locator('#nav-workflow').click();assert.ok((await page.locator('#workflow-references').textContent()).includes('1本'));
 await page.locator('#workflow-preview').click();assert.ok((await page.locator('#privacy-preview').textContent()).includes(selectedTitle));assert.ok((await page.locator('#privacy-preview').textContent()).includes('今回の事実根拠には使いません'));await page.locator('[data-close="privacy-dialog"]').click();
 let promise=page.waitForEvent('download');await page.locator('#brief-save').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await page.locator('#brief-save').click();let download=await promise;const brief=JSON.parse(await fs.readFile(await download.path(),'utf8'));assert.ok(!('editorialContext' in brief.brief));
 await page.locator('#nav-knowledge').click();promise=page.waitForEvent('download');await page.locator('#knowledge-save').click();download=await promise;const saved=JSON.parse(await fs.readFile(await download.path(),'utf8'));assert.equal(saved.docs.length,data.docs.length);assert.equal(saved.docs.filter(d=>d.body).length,data.docs.filter(d=>d.body).length);assert.ok(!JSON.stringify(saved).includes('googletag.cmd.push'));
 await page.screenshot({path:'/tmp/angle-knowledge-desktop.png',fullPage:true});
 for(const width of [390,768,1024]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`knowledge overflow ${width}`);}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/angle-knowledge-mobile.png',fullPage:true});
 await page.locator('#knowledge-clear').click();assert.equal(await page.locator('.knowledge-stats strong').first().textContent(),'0');await page.locator('#nav-workflow').click();assert.ok(!(await page.locator('#workflow-references').textContent()).includes('1本'));
 assert.equal(calls,0);assert.equal(await page.evaluate(()=>localStorage.length),0);assert.deepEqual(errors,[]);assert.deepEqual(csp,[]);
 console.log(`Knowledge browser verified: ${data.docs.length} metadata / ${data.docs.filter(d=>d.body).length} bodies, search, selection, send preview, local save and clear, mobile, no AI egress or persistence.`);
}finally{await browser.close();}
