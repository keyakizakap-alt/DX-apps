import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('/opt/codex/runtimes/cua/lib/node_modules/playwright-core');
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1448,height:1086}}),errors=[],csp=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.text().includes('Content Security Policy'))csp.push(m.text());});
 await page.goto(process.env.APP_TEST_URL||'http://127.0.0.1:4173/');await page.locator('#dashboard-view').waitFor({state:'visible'});
 const layout=await page.evaluate(()=>({rules:[...document.styleSheets].find(s=>s.href?.endsWith('/dashboard.css'))?.cssRules.length||0,header:document.querySelector('.app-header').getBoundingClientRect().height,logo:document.querySelector('.angle-mark').getBoundingClientRect().width,columns:getComputedStyle(document.querySelector('.dashboard-columns')).display}));assert.ok(layout.rules>250,'dashboard stylesheet must load');assert.ok(layout.header<120,'header must remain compact');assert.ok(layout.logo<80,'logo must remain within header');assert.equal(layout.columns,'grid');
 assert.equal(await page.locator('.stage').count(),6);assert.equal(await page.locator('#legend-done').textContent(),'0');
 await page.screenshot({path:'/tmp/angle-dashboard-desktop.png',fullPage:true});
 await page.locator('#project-deadline').fill('2026-10-30');await page.locator('#nav-calendar').click();assert.equal(await page.locator('#calendar-deadline').inputValue(),'2026-10-30');
 await page.locator('#nav-templates').click();await page.locator('[data-template="interview"]').click();assert.equal(await page.locator('#wf-media').inputValue(),'インタビュー記事');assert.ok((await page.locator('#wf-goal').inputValue()).includes('取材'));
 await page.locator('#wf-topic').fill('<img src=x onerror=alert(1)>');await page.locator('#nav-dashboard').click();assert.equal(await page.locator('#dashboard-title').textContent(),'<img src=x onerror=alert(1)>');assert.equal(await page.locator('#dashboard-title img').count(),0);
 await page.locator('#nav-knowledge').click();await page.locator('#knowledge-note').fill('非公開の編集メモ');await page.locator('#nav-team').click();assert.equal(await page.locator('#section-content .task-row').count(),17);
 await page.locator('#nav-knowledge').click();assert.equal(await page.locator('#knowledge-note').inputValue(),'非公開の編集メモ');
 await page.locator('#dashboard-search').fill('取材');assert.ok(await page.locator('#section-content .task-row').count()<17);
 await page.locator('#nav-dashboard').click();await page.locator('#notification-bell').click();assert.ok((await page.locator('#notification-list').textContent()).includes('通知はまだ'));await page.locator('[data-close="notification-dialog"]').click();
 for(const width of [390,768,1024,1448]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`dashboard overflow at ${width}`);}
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.sidebar')).position),'fixed');assert.equal(await page.evaluate(()=>Math.round(document.querySelector('.sidebar').getBoundingClientRect().top)),65);await page.screenshot({path:'/tmp/angle-dashboard-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>localStorage.length),0);assert.deepEqual(errors,[]);assert.deepEqual(csp,[]);
 console.log('Dashboard checks passed: state, safe rendering, templates, tasks/search, calendar, notes, notifications and four responsive widths.');
}finally{await browser.close();}
