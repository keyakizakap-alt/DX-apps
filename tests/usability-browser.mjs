import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {deflateRawSync} from 'node:zlib';
function wordFixture(){
 const xml=Buffer.from('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>取材の記録</w:t></w:r></w:p><w:p><w:r><w:t>連絡先 sample@example.com。改善は30％でした。</w:t></w:r></w:p></w:body></w:document>'),name=Buffer.from('word/document.xml'),compressed=deflateRawSync(xml);
 let crc=0xffffffff;for(const byte of xml){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(xml.length,22);local.writeUInt16LE(name.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(xml.length,24);central.writeUInt16LE(name.length,28);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+compressed.length,16);return Buffer.concat([local,name,compressed,central,name,end]);
}
const {chromium}=createRequire(import.meta.url)('/opt/codex/runtimes/cua/lib/node_modules/playwright-core');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await context.addInitScript(()=>{window.clipboardText='貼り付けた取材資料';window.copiedText='';window.denyPaste=false;Object.defineProperty(navigator,'clipboard',{value:{readText:async()=>{if(window.denyPaste)throw new Error('denied');return window.clipboardText;},writeText:async text=>window.copiedText=text}});});
 const page=await context.newPage(),errors=[],csp=[];let aiCalls=0;
 page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.text().includes('Content Security Policy'))csp.push(m.text());});
 await page.route('**/api/agents',r=>{aiCalls++;return r.abort();});
 await page.goto('http://127.0.0.1:4173/');await page.locator('#nav-workflow').click();
 assert.equal(await page.getByText('HOTL',{exact:false}).count(),0);assert.equal(await page.getByText('検索の追加料金が発生します',{exact:false}).count(),0);
 assert.equal(await page.locator('#wf-topic').isVisible(),true);assert.equal(await page.locator('#wf-transcript').isVisible(),false);assert.equal(await page.locator('#wf-metrics').isVisible(),false);
 assert.equal(await page.locator('#project-stages .project-stage').count(),6);assert.equal(await page.locator('#workflow-phase').textContent(),'待機中');
 await page.screenshot({path:'/tmp/angle-project-simple.png',fullPage:true});
 await page.locator('#materials-details > summary').click();
 await page.locator('[data-material-action="upload"][data-material-target="wf-transcript"]').click();
 await page.locator('#material-file').setInputFiles({name:'取材.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:wordFixture()});
 await page.waitForFunction(()=>document.getElementById('wf-transcript').value.includes('30％'));
 assert.ok((await page.locator('#wf-transcript').inputValue()).includes('取材の記録\n連絡先'));
 await page.locator('#workflow-preview').click();assert.ok(!(await page.locator('#privacy-preview').textContent()).includes('sample@example.com'));await page.locator('[data-close="privacy-dialog"]').click();
 await page.locator('[data-material-action="copy"][data-material-target="wf-transcript"]').click();assert.ok((await page.evaluate(()=>window.copiedText)).includes('30％'));
 let promise=page.waitForEvent('download');await page.locator('[data-material-action="save"][data-material-target="wf-transcript"]').click();let file=await promise;assert.ok((await fs.readFile(await file.path(),'utf8')).includes('30％'));
 await page.locator('[data-material-action="paste"][data-material-target="wf-sources"]').click();assert.equal(await page.locator('#wf-sources').inputValue(),'貼り付けた取材資料');
 await page.evaluate(()=>window.denyPaste=true);await page.locator('[data-material-action="paste"][data-material-target="wf-rules"]').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'wf-rules');
 await page.locator('#wf-topic').fill('取材記事');await page.locator('#wf-audience').fill('経営者');await page.locator('#wf-goal').fill('改善の取り組みを伝える');
 promise=page.waitForEvent('download');await page.locator('#brief-save').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await page.locator('#brief-save').click();file=await promise;const saved=await fs.readFile(await file.path(),'utf8');assert.equal(JSON.parse(saved).brief.topic,'取材記事');assert.equal(JSON.parse(saved).brief.webSearch,false);assert.ok(!saved.includes('consent'));
 await page.locator('#workflow-clear').click();assert.equal(await page.locator('#wf-topic').inputValue(),'');
 await page.locator('#brief-import').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await page.locator('#brief-import').click();await page.locator('#brief-file').setInputFiles({name:'企画.json',mimeType:'application/json',buffer:Buffer.from(saved)});await page.waitForFunction(()=>document.getElementById('wf-topic').value==='取材記事');assert.ok((await page.locator('#wf-transcript').inputValue()).includes('30％'));assert.equal(await page.locator('#wf-web-search').isChecked(),false);
 await page.locator('#brief-import').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await page.locator('#brief-import').click();await page.locator('#brief-file').setInputFiles({name:'不正.json',mimeType:'application/json',buffer:Buffer.from('{"version":1,"brief":{"topic":"置き換え","consent":true}}')});await page.waitForFunction(()=>document.getElementById('transfer-status').textContent.includes('対応していない'));assert.equal(await page.locator('#wf-topic').inputValue(),'取材記事');
 await page.locator('[data-material-action="upload"][data-material-target="wf-sources"]').click();await page.locator('#material-file').setInputFiles({name:'超過.txt',mimeType:'text/plain',buffer:Buffer.from('x'.repeat(20001))});await page.waitForFunction(()=>document.getElementById('transfer-status').textContent.includes('20,000'));assert.equal(await page.locator('#wf-sources').inputValue(),'貼り付けた取材資料');
 await page.locator('#nav-editor').click();const guide=page.locator('.guide-top');assert.equal(await guide.isVisible(),true);assert.equal(await guide.locator('h2').evaluate(e=>getComputedStyle(e).color),'rgb(38, 52, 84)');assert.equal(await guide.locator('p').evaluate(e=>getComputedStyle(e).color),'rgb(82, 97, 123)');
 await page.screenshot({path:'/tmp/angle-review-readable.png',fullPage:true});
 for(const width of [390,768,1024]){await page.setViewportSize({width,height:844});await page.locator('#nav-workflow').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`project overflow ${width}`);}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/angle-project-simple-mobile.png',fullPage:true});
 assert.equal(aiCalls,0);assert.equal(await page.evaluate(()=>localStorage.length),0);assert.deepEqual(errors,[]);assert.deepEqual(csp,[]);
 console.log('Usability checks passed: progressive fields, Word/text import, clipboard fallback, readable downloads, safe project restore, private preview, guide contrast, mobile and no automatic AI sending.');
}finally{await browser.close();}
