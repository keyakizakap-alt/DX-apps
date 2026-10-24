// Browser E2E against the real web build (dist/) and the real sync server, in Chromium.
// Contexts: PC 1280px, iPhone-size 390px (UA emulation), Android-size 412px (UA emulation).
// NOTE: this is Chromium emulation, not Safari / real devices. See docs/PROGRESS.md.
// Usage: npm run build:web && npm run test:e2e
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

const OUT = resolve('test-results/e2e');
mkdirSync(OUT, { recursive: true });
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const PII = ['架空 花子', '架空', 'hanako.kakuu', '090-0000-1001', 'テスト商事', '試験 太郎'];

// ---- server ---------------------------------------------------------------------------------

async function freePort(): Promise<number> {
  return new Promise((r) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => r(p));
    });
  });
}

interface Server {
  url: string;
  dbPath: string;
  nextOtp(): Promise<string>;
  stop(): void;
  log: string[];
}

async function startServer(): Promise<Server> {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'meishi-e2e-'));
  const dbPath = join(dir, 'sync.sqlite');
  const url = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'server/main.mts'], {
    env: { ...process.env, PORT: String(port), MEISHI_DB_PATH: dbPath, MEISHI_STATIC_DIR: resolve('dist'), MEISHI_AI_FAKE: '1', MEISHI_ALLOWED_ORIGINS: url, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log: string[] = [];
  const otps: string[] = [];
  const waiters: Array<(c: string) => void> = [];
  const onLine = (buf: Buffer) => {
    for (const line of buf.toString().split('\n')) {
      if (!line.trim()) continue;
      log.push(line);
      const m = line.match(/確認コード (\d{6})/);
      if (m) {
        const w = waiters.shift();
        if (w) w(m[1]!);
        else otps.push(m[1]!);
      }
    }
  };
  child.stdout!.on('data', onLine);
  child.stderr!.on('data', onLine);
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url,
    dbPath,
    log,
    nextOtp: () => (otps.length ? Promise.resolve(otps.shift()!) : new Promise((r) => waiters.push(r))),
    stop: () => {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ---- harness --------------------------------------------------------------------------------

const results: Array<{ name: string; ok: boolean; ms: number; error?: string }> = [];
const openPages: Array<{ kind: string; page: Page }> = [];
const consoleProblems: string[] = [];

async function scenario(name: string, fn: () => Promise<void>) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`✓ ${name} (${Date.now() - t}ms)`);
  } catch (e) {
    const error = e instanceof Error ? e.message.split('\n').slice(0, 6).join('\n') : String(e);
    results.push({ name, ok: false, ms: Date.now() - t, error });
    for (const [i, p] of openPages.entries()) await p.page.screenshot({ path: join(OUT, `FAIL-${results.length}-${i}-${p.kind}.png`) }).catch(() => undefined);
    console.log(`✗ ${name}\n  ${error}`);
  }
}

async function newContext(browser: Browser, kind: 'pc' | 'iphone' | 'android'): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(
    kind === 'pc'
      ? { viewport: { width: 1280, height: 860 }, locale: 'ja-JP' }
      : kind === 'iphone'
        ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, locale: 'ja-JP' }
        : { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: ANDROID_UA, locale: 'ja-JP' },
  );
  const page = await ctx.newPage();
  openPages.push({ kind, page });
  page.on('console', (m) => {
    const text = m.text();
    // Expected: 401/404 API answers, fetch failures while a scenario is deliberately offline, and
    // Tesseract's benign "Parameter not found" lines for legacy-engine settings in LSTM mode.
    if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of (401|404)|Failed to load resource: net::ERR_INTERNET_DISCONNECTED|Parameter not found/.test(text)) consoleProblems.push(`[${kind}] ${text}`);
  });
  page.on('pageerror', (e) => consoleProblems.push(`[${kind}] pageerror: ${e.message}`));
  return { ctx, page };
}

const tid = (page: Page, id: string) => page.getByTestId(id);

/** In-app navigation. page.goto() reloads, and a reload correctly re-locks the vault. */
async function go(page: Page, path: string) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForTimeout(150);
}
const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });

async function createVault(page: Page, url: string, passcode?: string): Promise<string> {
  await page.goto(url);
  await tid(page, 'start-new').click();
  await tid(page, 'recovery-key-hidden').waitFor(); // shoulder-surfing: hidden until the user asks
  assert.equal(await tid(page, 'recovery-key').count(), 0, '復旧キーが最初から表示されている');
  await tid(page, 'reveal-recovery-key').click();
  const key = (await tid(page, 'recovery-key').innerText()).trim();
  const hint = await page.getByText(/復旧キーの \d+ 番目と \d+ 番目/).innerText();
  const [, g1, g2] = hint.match(/(\d+) 番目と (\d+) 番目/)!;
  const groups = key.split('-');
  await tid(page, 'confirm-a').fill(groups[Number(g1)]!);
  await tid(page, 'confirm-b').fill(groups[Number(g2)]!);
  if (passcode) await tid(page, 'new-passcode').fill(passcode);
  await tid(page, 'confirm-recovery').click();
  await tid(page, 'screen-home').waitFor();
  return key;
}

async function signIn(page: Page, server: Server, email: string) {
  await tid(page, 'email').fill(email);
  const otp = server.nextOtp();
  await tid(page, 'send-code').click();
  await tid(page, 'otp').fill(await otp);
  await tid(page, 'verify-code').click();
}

async function syncNow(page: Page) {
  await go(page, '/settings/sync');
  await tid(page, 'sync-now').click();
  await page.waitForFunction(() => /最終同期/.test(document.body.innerText) && !/同期中…/.test(document.body.innerText), undefined, { timeout: 15000 });
}

async function storageDump(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const out: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie];
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('meishi-agent');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    for (const name of ['meta', 'records', 'blobs']) {
      const all: unknown[] = await new Promise((res) => {
        const req = db.transaction(name).objectStore(name).getAll();
        req.onsuccess = () => res(req.result);
      });
      out.push(
        JSON.stringify(all, (_k, v) => (v instanceof Uint8Array ? new TextDecoder('utf-8', { fatal: false }).decode(v) : v instanceof CryptoKey ? `CryptoKey(extractable=${v.extractable})` : v)),
      );
    }
    db.close();
    return out.join('\n');
  });
}

async function renderCardImage(browser: Browser, kind: 'png' | 'pdf'): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 910, height: 550 } });
  await page.setContent(`<html><body style="margin:0;background:#fff;font-family:'IPAGothic',sans-serif">
    <div id="card" style="width:910px;height:550px;padding:48px 60px;box-sizing:border-box;color:#111">
      <div style="font-size:34px">テスト商事株式会社</div>
      <div style="font-size:28px;margin-top:22px">営業本部 第一営業部 部長</div>
      <div style="font-size:64px;margin-top:20px;letter-spacing:6px">架空 花子</div>
      <div style="font-size:26px;margin-top:26px">TEL 03-0000-1000</div>
      <div style="font-size:26px">携帯 090-0000-1001</div>
      <div style="font-size:28px">hanako.kakuu@example.test</div>
    </div></body></html>`);
  const buf = kind === 'png' ? await page.locator('#card').screenshot() : await page.pdf({ width: '91mm', height: '55mm', printBackground: true, scale: 0.4 });
  await page.close();
  return buf;
}

// ---- scenarios ------------------------------------------------------------------------------

const server = await startServer();
const browser = await chromium.launch();
console.log(`server ${server.url}, chromium ${browser.version()}`);

try {
  const pc = await newContext(browser, 'pc');
  let pcKey = '';

  await scenario('PC: S00→S01 保管庫作成と復旧キー確認、S03 ホーム、DEMO架空データ', async () => {
    await pc.page.goto(server.url);
    await shot(pc.page, 'pc-00-welcome');
    pcKey = await createVault(pc.page, server.url);
    assert.match(pcKey, /^MK1(-[0-9A-Z]{5}){11}$/, '復旧キーの形式が想定外。直し方: formatRecoveryKey を確認する');
    await tid(pc.page, 'home-empty').waitFor();
    await tid(pc.page, 'load-demo').click();
    await pc.page.getByText('架空 花子').first().waitFor();
    assert.equal(await tid(pc.page, 'kpi-contacts').innerText().then((t) => t.match(/\d+/)?.[0]), '9', '登録数が9でない。直し方: loadDemoData とホームの集計を確認する');
    await shot(pc.page, 'pc-01-home');
  });

  await scenario('PC: S08 検索（端末内）・2ペイン詳細・"/"ショートカット', async () => {
    await tid(pc.page, 'kpi-contacts').click();
    await tid(pc.page, 'screen-people').waitFor();
    await pc.page.locator('body').click({ position: { x: 600, y: 10 } });
    await pc.page.keyboard.press('/');
    await pc.page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'people-search', undefined, { timeout: 3000 }).catch(() => undefined);
    assert.equal(await pc.page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'people-search', '"/" で検索欄にフォーカスしない');
    await tid(pc.page, 'people-search').fill('EXPO');
    await pc.page.waitForTimeout(200);
    assert.equal(await tid(pc.page, 'people-row').count(), 2, 'イベント名での検索件数が2でない');
    await tid(pc.page, 'people-row').first().click();
    await tid(pc.page, 'person-detail').waitFor();
    await shot(pc.page, 'pc-02-people');
    await tid(pc.page, 'people-search').fill('存在しない人');
    await tid(pc.page, 'people-empty').waitFor();
  });

  await scenario('PC: S09/S10 出会いメモ追加（明示保存・離脱確認）とタグ追加', async () => {
    await tid(pc.page, 'people-search').fill('架空 花子');
    await tid(pc.page, 'people-row').first().click();
    await pc.page.getByRole('button', { name: '詳細ページ' }).click();
    await tid(pc.page, 'screen-person').waitFor();
    await tid(pc.page, 'add-encounter').click();
    await tid(pc.page, 'enc-event').fill('架空商談会');
    await tid(pc.page, 'encounter-back').click();
    await tid(pc.page, 'discard-changes').waitFor();
    await pc.page.getByRole('button', { name: '編集を続ける' }).click();
    await tid(pc.page, 'enc-conversation').fill('見積りの件で再訪問予定');
    await tid(pc.page, 'enc-save').click();
    await tid(pc.page, 'screen-person').waitFor();
    await pc.page.getByText('架空商談会').waitFor();
    await tid(pc.page, 'new-tag').fill('重要');
    await pc.page.getByRole('button', { name: '追加', exact: true }).first().click();
    await pc.page.getByText('#重要 ×').waitFor();
    await shot(pc.page, 'pc-03-person');
  });

  await scenario('PC: S11 ローカルAI検索・下書き（外部AIは既定オフ）', async () => {
    await go(pc.page, '/assistant');
    await tid(pc.page, 'assistant-input').fill('架空EXPOで会った人');
    await tid(pc.page, 'assistant-run').click();
    await tid(pc.page, 'assistant-answer').waitFor();
    assert.equal(await tid(pc.page, 'assistant-person').count(), 2, 'ローカル検索の件数が2でない');
    await tid(pc.page, 'assistant-input').fill('架空 花子さんへのお礼メール');
    await tid(pc.page, 'assistant-run').click();
    await tid(pc.page, 'draft-card').waitFor();
    assert.ok((await tid(pc.page, 'draft-body').inputValue()).includes('架空 花子 様'), '下書きに宛名がない');
    assert.ok(await tid(pc.page, 'external-ai').isDisabled(), '外部AIが既定で使える状態になっている');
    await shot(pc.page, 'pc-04-assistant');
  });

  await scenario('PC: S07 重複候補（同姓同名は低一致、別人の判断で消える・自動統合なし）', async () => {
    await go(pc.page, '/duplicates');
    await tid(pc.page, 'screen-duplicates').waitFor();
    const before = await tid(pc.page, 'duplicate-pair').count();
    assert.ok(before >= 2, `重複候補が${before}件`);
    await shot(pc.page, 'pc-05-duplicates');
    await tid(pc.page, 'mark-different').first().click();
    await pc.page.waitForTimeout(200);
    assert.equal(await tid(pc.page, 'duplicate-pair').count(), before - 1);
    await go(pc.page, '/home');
    assert.equal(await tid(pc.page, 'kpi-contacts').innerText().then((t) => t.match(/\d+/)?.[0]), '9', '判断で人物数が変わった');
  });

  await scenario('PC: ロック・再読み込み後に鍵や平文が残らない（SEC-03）・誤キーの遅延', async () => {
    await tid(pc.page, 'lock-now').click();
    await tid(pc.page, 'screen-unlock').waitFor();
    assert.ok(!(await pc.page.locator('body').innerText()).includes('架空'), 'ロック中に氏名が表示された');
    await pc.page.reload();
    await tid(pc.page, 'screen-unlock').waitFor();
    const dump = await storageDump(pc.page);
    for (const p of [...PII, pcKey, pcKey.replaceAll('-', '')]) assert.ok(!dump.includes(p), `ブラウザ保存領域に「${p}」が平文で残っている`);
    assert.ok(!dump.includes('extractable=true'), '抽出可能な鍵がIndexedDBにある');
    const wrong = `MK1-${pcKey.slice(4).split('-').reverse().join('-')}`;
    for (let i = 0; i < 3; i++) {
      await tid(pc.page, 'unlock-secret').fill(wrong);
      await tid(pc.page, 'unlock-submit').click();
      await pc.page.waitForTimeout(150);
    }
    await pc.page.getByText(/秒後に再試行/).first().waitFor();
    await shot(pc.page, 'pc-06-unlock-throttled');
    await pc.page.waitForFunction(() => !/秒後に再試行できます/.test(document.body.innerText), undefined, { timeout: 10000 });
    await tid(pc.page, 'unlock-secret').fill(pcKey);
    await tid(pc.page, 'unlock-submit').click();
    await tid(pc.page, 'screen-home').waitFor();
    await pc.page.getByText('架空 花子').first().waitFor();
  });

  await scenario('PC: S14 設定・S14 監査ログに個人情報がない（SEC-14）', async () => {
    await go(pc.page, '/settings');
    await tid(pc.page, 'autolock-15').click();
    await go(pc.page, '/settings/audit');
    await tid(pc.page, 'screen-audit').waitFor();
    const text = await pc.page.locator('body').innerText();
    assert.ok(/ロック解除の失敗/.test(text) && /データ登録/.test(text), '監査ログに想定の操作がない');
    assert.match(await tid(pc.page, 'audit-chain').innerText(), /異常なし/, '監査ログのハッシュチェーン検証が通らない');
    for (const p of PII) assert.ok(!text.includes(p), `監査画面に「${p}」`);
    await shot(pc.page, 'pc-07-audit');
  });

  await scenario('PC: S15 CSVは再認証と件数確認が必要・数式インジェクション対策', async () => {
    await go(pc.page, '/settings/export');
    assert.ok(await tid(pc.page, 'csv-prepare').isDisabled(), '再認証なしでCSV準備できる');
    await tid(pc.page, 'reauth-key').fill(pcKey);
    await tid(pc.page, 'csv-prepare').click();
    const dl = pc.page.waitForEvent('download');
    await tid(pc.page, 'csv-download').click();
    const file = await (await dl).path();
    const csv = (await import('node:fs')).readFileSync(file!, 'utf8');
    assert.ok(csv.startsWith('﻿"氏名"'), 'CSVの先頭がBOM+見出しでない');
    assert.equal(csv.trim().split('\r\n').length, 10, 'CSV行数が9+見出しでない');
    const backup = pc.page.waitForEvent('download');
    await tid(pc.page, 'backup-download').click();
    const bfile = (await import('node:fs')).readFileSync((await (await backup).path())!, 'utf8');
    for (const p of PII) assert.ok(!bfile.includes(p), `暗号化バックアップに「${p}」が平文で含まれる`);
  });

  // ---- phone: scan + OCR -------------------------------------------------------------------
  const phone = await newContext(browser, 'iphone');
  let phoneKey = '';

  await scenario('iPhoneサイズ: 下部タブ・横スクロールなし・S04→S05 取込（PNG×2, 同一画像は除外, PDF）', async () => {
    phoneKey = await createVault(phone.page, server.url, 'phone-passcode-2026');
    await tid(phone.page, 'tab-scan').waitFor();
    const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `横スクロールが発生（${overflow}px）`);
    await shot(phone.page, 'iphone-01-home-empty');
    await tid(phone.page, 'tab-scan').click();
    const png = await renderCardImage(browser, 'png');
    const pdf = await renderCardImage(browser, 'pdf');
    const chooser = phone.page.waitForEvent('filechooser');
    await tid(phone.page, 'pick-files').click();
    await (await chooser).setFiles([
      { name: 'kakuu-card.png', mimeType: 'image/png', buffer: png },
      { name: 'kakuu-card-copy.png', mimeType: 'image/png', buffer: png },
      { name: 'kakuu-card.pdf', mimeType: 'application/pdf', buffer: pdf },
    ]);
    await tid(phone.page, 'scan-message-0').waitFor();
    const msgs = await phone.page.locator('[data-testid^="scan-message-"]').allInnerTexts();
    assert.ok(msgs.some((m) => /2枚をキューに追加/.test(m)), `取込メッセージ: ${msgs.join(' / ')}`);
    assert.ok(msgs.some((m) => /同じ画像 1枚/.test(m)), '同一画像が除外されていない');
    await shot(phone.page, 'iphone-02-scan');
  });

  let ocrSummary = '';
  await scenario('iPhoneサイズ: 端末内日本語OCR（Tesseract jpn）→ S06 確認・修正 → 保存', async () => {
    await tid(phone.page, 'open-queue').click();
    await phone.page.waitForFunction(() => document.querySelectorAll('[data-testid^="queue-status-"]').length === 2 && [...document.querySelectorAll('[data-testid^="queue-status-"]')].every((e) => /要確認|失敗/.test((e as HTMLElement).innerText)), undefined, { timeout: 120000 });
    await shot(phone.page, 'iphone-03-queue');
    const statuses = await phone.page.locator('[data-testid^="queue-status-"]').allInnerTexts();
    assert.deepEqual(statuses, ['要確認', '要確認'], `OCR結果: ${statuses.join(',')}`);
    await tid(phone.page, 'go-review').click();
    await tid(phone.page, 'screen-review').waitFor();
    const values: Record<string, string> = {};
    for (const k of ['fullName', 'company', 'title', 'department', 'email', 'phone', 'mobile']) values[k] = await tid(phone.page, `field-${k}`).inputValue();
    const expected: Record<string, string> = { fullName: '架空 花子', company: 'テスト商事株式会社', title: '部長', department: '営業本部 第一営業部', email: 'hanako.kakuu@example.test', phone: '03-0000-1000', mobile: '090-0000-1001' };
    const hits = Object.keys(expected).filter((k) => values[k]!.replace(/\s/g, '') === expected[k]!.replace(/\s/g, ''));
    ocrSummary = `OCR一致 ${hits.length}/${Object.keys(expected).length}: ${JSON.stringify(values)}`;
    console.log(`  ${ocrSummary}`);
    assert.ok(hits.length >= 4, `端末内OCRの一致が少なすぎる。${ocrSummary}`);
    await shot(phone.page, 'iphone-04-review');
    // Human correction: fix every field to the true value, then verify.
    for (const [k, v] of Object.entries(expected)) await tid(phone.page, `field-${k}`).fill(v);
    await tid(phone.page, 'verify-all').click();
    await tid(phone.page, 'save-new').click();
    await tid(phone.page, 'screen-review').waitFor(); // second card opens next
    await tid(phone.page, 'duplicate-panel').waitFor();
    await shot(phone.page, 'iphone-05-duplicate');
    // The second card is the same person: attach to the existing contact (no automatic merge).
    await phone.page.locator('[data-testid^="same-person-"]').first().click();
    await tid(phone.page, 'screen-person').waitFor();
    assert.equal(await tid(phone.page, 'person-name').innerText(), '架空 花子');
    assert.ok((await phone.page.locator('body').innerText()).includes('名刺（2）'), '同じ人物に名刺が2枚付いていない');
  });

  await scenario('iPhoneサイズ: 再読み込み後もキューと暗号化データが残り、パスコードで解除', async () => {
    await phone.page.reload();
    await tid(phone.page, 'screen-unlock').waitFor();
    await tid(phone.page, 'unlock-secret').fill('phone-passcode-2026');
    await tid(phone.page, 'unlock-submit').click();
    await tid(phone.page, 'screen-home').waitFor({ timeout: 20000 });
    await tid(phone.page, 'tab-people').click();
    await phone.page.getByText('架空 花子').first().waitFor();
    await phone.page.getByText('架空 花子').first().click();
    await phone.page.getByText('名刺（2）').waitFor();
    await tid(phone.page, 'tab-scan').click();
    await phone.page.getByText(/現在のキュー 0\/50/).waitFor();
  });

  // ---- cross-device sync ----------------------------------------------------------------------
  const email = 'kakuu.owner@example.test';
  const laptop = await newContext(browser, 'pc');

  await scenario('同期: iPhone登録→PCを復旧キーで追加→PC編集→iPhoneに反映（E2EE）', async () => {
    await go(phone.page, '/settings/sync');
    await tid(phone.page, 'sync-sign-in').click();
    await signIn(phone.page, server, email);
    await tid(phone.page, 'screen-sync').waitFor();
    await syncNow(phone.page);
    await shot(phone.page, 'iphone-06-sync');

    await laptop.page.goto(server.url);
    await tid(laptop.page, 'start-restore').click();
    await signIn(laptop.page, server, email);
    await tid(laptop.page, 'screen-restore').waitFor();
    await tid(laptop.page, 'restore-key').fill(phoneKey);
    await tid(laptop.page, 'restore-submit').click();
    await tid(laptop.page, 'screen-home').waitFor();
    await go(laptop.page, '/settings/sync');
    await syncNow(laptop.page);
    await go(laptop.page, '/people');
    await laptop.page.getByText('架空 花子').first().waitFor({ timeout: 15000 });
    await tid(laptop.page, 'people-row').first().click();
    await laptop.page.getByRole('button', { name: '詳細ページ' }).click();
    await tid(laptop.page, 'new-tag').fill('PCで追加');
    await laptop.page.getByRole('button', { name: '追加', exact: true }).first().click();
    await laptop.page.getByText('#PCで追加 ×').waitFor();
    await syncNow(laptop.page);
    await syncNow(phone.page);
    await tid(phone.page, 'tab-people').click();
    await phone.page.getByText('架空 花子').first().click();
    await phone.page.getByText('#PCで追加 ×').waitFor({ timeout: 10000 });
    await shot(laptop.page, 'pc-08-synced-from-iphone');
  });

  await scenario('同期: サーバーDBに平文の氏名・メール・電話・復旧キーがない（SEC-06 実測）', async () => {
    const db = new DatabaseSync(server.dbPath, { readOnly: true });
    const chunks: string[] = [];
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>) {
      for (const row of db.prepare(`SELECT * FROM "${name}"`).all() as Array<Record<string, unknown>>) {
        for (const v of Object.values(row)) chunks.push(v instanceof Uint8Array ? Buffer.from(v).toString('utf8') : String(v));
      }
    }
    db.close();
    const all = chunks.join('\n');
    assert.ok(all.length > 1000, 'サーバーDBが空');
    for (const p of [...PII, email, phoneKey, 'PCで追加']) assert.ok(!all.includes(p), `サーバーDBに「${p}」が平文で存在`);
    const logs = server.log.join('\n');
    for (const p of [...PII, phoneKey]) assert.ok(!logs.includes(p), `サーバーログに「${p}」`);
  });

  await scenario('オフライン: 編集は保持され「同期待ち」表示、復帰後に送信される', async () => {
    await phone.ctx.setOffline(true);
    await phone.page.getByRole('button', { name: '確認済みにする' }).count(); // ensure page alive
    await tid(phone.page, 'new-tag').fill('オフライン編集');
    await phone.page.getByRole('button', { name: '追加', exact: true }).first().click();
    await phone.page.getByText('#オフライン編集 ×').waitFor();
    await phone.page.waitForTimeout(2600); // debounce → sync attempt fails
    const label = await tid(phone.page, 'sync-status').innerText();
    assert.match(label, /オフライン|同期待ち|同期エラー/, `オフライン時の表示: ${label}`);
    await shot(phone.page, 'iphone-07-offline');
    await phone.ctx.setOffline(false);
    await syncNow(phone.page);
    assert.match(await tid(phone.page, 'sync-label').innerText(), /最終同期/);
    await syncNow(laptop.page);
    await go(laptop.page, '/people');
    await tid(laptop.page, 'people-search').fill('オフライン編集');
    await laptop.page.waitForTimeout(200);
    assert.equal(await tid(laptop.page, 'people-row').count(), 1, 'オフライン編集がPCに届いていない');
  });

  await scenario('オフライン再読み込み: Service Workerでアプリが開き、端末内データを閲覧できる', async () => {
    const swReady = await phone.page.evaluate(async () => Boolean(await navigator.serviceWorker?.getRegistration()));
    assert.ok(swReady, 'Service Worker が登録されていない');
    await phone.ctx.setOffline(true);
    try {
      await phone.page.reload();
      await tid(phone.page, 'screen-unlock').waitFor({ timeout: 15000 });
      await tid(phone.page, 'unlock-secret').fill('phone-passcode-2026');
      await tid(phone.page, 'unlock-submit').click();
      await tid(phone.page, 'screen-home').waitFor({ timeout: 20000 });
      await tid(phone.page, 'tab-people').click();
      await phone.page.getByText('架空 花子').first().waitFor();
      await shot(phone.page, 'iphone-08-offline-reload');
    } finally {
      await phone.ctx.setOffline(false);
    }
  });

  await scenario('競合: 両端末で同じ人物を編集 → 競合表示 → 両方残す（SEC-16）', async () => {
    const editNote = async (page: Page, note: string) => {
      await go(page, '/people');
      await (page.viewportSize()!.width > 900 ? tid(page, 'people-search') : tid(page, 'people-search')).fill('架空 花子');
      await page.waitForTimeout(200);
      if (page.viewportSize()!.width > 900) {
        await tid(page, 'people-row').first().click();
        await page.getByRole('button', { name: '詳細ページ' }).click();
      } else {
        await tid(page, 'people-card').first().click();
      }
      await tid(page, 'edit-person').click();
      await page.getByLabel('メモ', { exact: true }).fill(note);
      await tid(page, 'edit-save').click();
      await tid(page, 'screen-person').waitFor();
    };
    await editNote(phone.page, 'iPhoneのメモ');
    await editNote(laptop.page, 'PCのメモ');
    await syncNow(phone.page);
    await syncNow(laptop.page).catch(() => undefined);
    await go(laptop.page, '/settings/sync');
    await tid(laptop.page, 'open-conflicts').click();
    await tid(laptop.page, 'conflict-item').first().waitFor();
    await shot(laptop.page, 'pc-09-conflict');
    await tid(laptop.page, 'keep-both').first().click();
    await laptop.page.waitForTimeout(300);
    await syncNow(laptop.page);
    await syncNow(phone.page);
    await go(phone.page, '/people');
    await tid(phone.page, 'people-search').fill('架空 花子');
    await phone.page.waitForTimeout(300);
    assert.equal(await tid(phone.page, 'people-card').count(), 2, '両方残すの結果がiPhoneに2件として届いていない');
  });

  await scenario('外部AI: 承認前の通信0件、承認後は表示した項目だけが1回送信（SEC-09/10）', async () => {
    const aiRequests: Array<{ url: string; body: string }> = [];
    laptop.page.on('request', (r) => {
      if (r.url().includes('/api/ai/')) aiRequests.push({ url: r.url(), body: r.postData() ?? '' });
    });
    await go(laptop.page, '/settings');
    await tid(laptop.page, 'external-ai-toggle').click();
    await go(laptop.page, '/people');
    await tid(laptop.page, 'people-search').fill('架空 花子');
    await laptop.page.waitForTimeout(200);
    await tid(laptop.page, 'people-row').first().click();
    await laptop.page.getByRole('button', { name: '詳細ページ' }).click();
    await tid(laptop.page, 'add-encounter').click();
    await tid(laptop.page, 'enc-event').fill('架空フォーラム');
    await tid(laptop.page, 'enc-conversation').fill('外部送信テスト用の会話メモ');
    await tid(laptop.page, 'enc-save').click();
    await tid(laptop.page, 'screen-person').waitFor();
    await tid(laptop.page, 'make-draft').click();
    await tid(laptop.page, 'draft-card').waitFor();
    await tid(laptop.page, 'external-ai').click();
    await tid(laptop.page, 'screen-approve').waitFor();
    assert.equal(aiRequests.length, 0, '承認画面の表示までに外部AI向け通信が発生した');
    assert.ok((await tid(laptop.page, 'approve-body').innerText()).includes('外部送信テスト用の会話メモ'), '会話メモがプレビューにない');
    assert.equal(await tid(laptop.page, 'include-conversation').getAttribute('aria-checked'), 'true');
    await tid(laptop.page, 'include-conversation').click();
    await laptop.page.waitForTimeout(200);
    assert.equal(await tid(laptop.page, 'include-conversation').getAttribute('aria-checked'), 'false', 'トグル表示が送信内容と一致しない');
    const shown = await tid(laptop.page, 'approve-body').innerText();
    assert.ok(!shown.includes('"conversation"') && !shown.includes('外部送信テスト用の会話メモ'), '外した項目が送信内容に残っている');
    assert.ok(!/@|090-|03-0000/.test(shown), '送信内容にメール/電話が含まれる');
    await shot(laptop.page, 'pc-10-approve');
    assert.equal(aiRequests.length, 0, '項目変更で外部AI向け通信が発生した');
    await tid(laptop.page, 'approve-send').click();
    await tid(laptop.page, 'external-result').waitFor();
    assert.equal(aiRequests.filter((r) => r.url.endsWith('/api/ai/consent')).length, 1);
    const drafts = aiRequests.filter((r) => r.url.endsWith('/api/ai/draft'));
    assert.equal(drafts.length, 1, '外部AIへの送信が1回でない');
    const sent = JSON.parse(drafts[0]!.body) as { request: { fields: Record<string, string> } };
    assert.deepEqual(Object.keys(sent.request.fields).sort(), Object.keys(JSON.parse(shown).fields).sort(), '送信した項目がプレビューと異なる');
    assert.ok(!drafts[0]!.body.includes('外部送信テスト用の会話メモ'), '外した会話メモが送信された');
    assert.ok((await tid(laptop.page, 'external-result').innerText()).includes('受け取った項目'));
    // Pseudonymization (default on): no real name/company in the preview or on the wire, restored on device.
    for (const real of ['架空 花子', '架空花子', 'テスト商事']) {
      assert.ok(!shown.includes(real), `送信本文プレビューに実名「${real}」`);
      assert.ok(!drafts[0]!.body.includes(real), `外部AIへの通信に実名「${real}」`);
    }
    assert.ok(shown.includes('〔相手の氏名〕'), '伏せ字になっていない');
    assert.ok((await tid(laptop.page, 'external-result').innerText()).includes('架空 花子 様'), '結果が端末内で実名に戻っていない');
  });

  await scenario('Androidサイズ: 初期画面・保管庫作成・下部タブ・横スクロールなし', async () => {
    const android = await newContext(browser, 'android');
    await createVault(android.page, server.url);
    await tid(android.page, 'tab-settings').click();
    await tid(android.page, 'screen-settings').waitFor();
    const overflow = await android.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `横スクロール ${overflow}px`);
    await shot(android.page, 'android-01-settings');
    await android.ctx.close();
  });

  await scenario('アクセシビリティ: ボタンに名前がある・タップ領域44px以上（主要画面）', async () => {
    const problems: string[] = [];
    for (const path of ['/home', '/people', '/scan', '/assistant', '/settings', '/settings/sync', '/settings/export']) {
      await go(phone.page, path);
      await phone.page.waitForTimeout(300);
      const bad = await phone.page.evaluate(() =>
        [...document.querySelectorAll('[role="button"],[role="tab"],[role="switch"],[role="checkbox"],[role="link"],button')]
          .filter((el) => (el as HTMLElement).offsetParent !== null && !el.closest('[aria-hidden="true"]'))
          .map((el) => {
            const r = el.getBoundingClientRect();
            const name = el.getAttribute('aria-label') || (el as HTMLElement).innerText.trim();
            return { name, h: Math.round(r.height), w: Math.round(r.width) };
          })
          .filter((x) => !x.name || x.h < 44),
      );
      bad.forEach((b) => problems.push(`${path}: "${b.name}" ${b.w}x${b.h}`));
    }
    assert.equal(problems.length, 0, `名前なし/小さすぎる操作要素: ${problems.slice(0, 8).join(' | ')}`);
  });

  await scenario('PWA: マニフェスト・アイコン・ホーム画面追加用のメタ情報', async () => {
    const { ctx, page } = await newContext(browser, 'android');
    try {
      await page.goto(server.url);
      const href = await page.locator('link[rel="manifest"]').getAttribute('href');
      assert.equal(href, '/manifest.webmanifest', 'manifest のリンクがない。直し方: public/index.html に <link rel="manifest"> を置く');
      const res = await page.request.get(`${server.url}${href}`);
      assert.equal(res.status(), 200);
      assert.match(res.headers()['content-type'] ?? '', /manifest\+json/, 'manifest の Content-Type が違う');
      const manifest = await res.json();
      assert.equal(manifest.display, 'standalone');
      assert.equal(manifest.start_url, '/');
      const sizes = manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}/${i.purpose}`).sort();
      assert.deepEqual(sizes, ['192x192/any', '512x512/any', '512x512/maskable'], 'インストールに必要なアイコンがそろっていない');
      for (const icon of [...manifest.icons, { src: await page.locator('link[rel="apple-touch-icon"]').getAttribute('href') }]) {
        const r = await page.request.get(`${server.url}${icon.src}`);
        assert.equal(r.status(), 200, `${icon.src} が取得できない`);
        assert.equal(r.headers()['content-type'], 'image/png');
      }
      // Google Play requires a web page for account-deletion requests (no reinstall needed).
      await page.goto(`${server.url}/account-deletion.html`);
      await page.getByRole('heading', { name: 'アカウントとデータの削除' }).waitFor();
      assert.ok(await page.getByText('同期アカウントを削除').count(), '削除手順にアプリ内の実際のボタン名がない');
    } finally {
      await ctx.close();
    }
  });

  await scenario('コンソールエラー・CSP違反がない', async () => {
    assert.equal(consoleProblems.length, 0, consoleProblems.slice(0, 10).join('\n'));
  });

  console.log(`\n${ocrSummary}`);
} finally {
  await browser.close();
  server.stop();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nE2E: ${results.length - failed.length}/${results.length} passed. Screenshots: ${OUT}`);
(await import('node:fs')).writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
