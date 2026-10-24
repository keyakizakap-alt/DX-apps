// SEC-03 / SEC-19: no secrets, keys or real-looking recovery keys in the source tree; the test-only
// nonce hook is not used by production code; app code does not log to the console.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const SKIP = new Set(['node_modules', 'dist', '.expo', 'test-results', 'ocr', '.data', 'ios', 'android']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.git')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|mjs|js|json|md|yml|yaml|html|txt|env|example)$/.test(name) && st.size < 2_000_000) out.push(p);
  }
  return out;
}

const files = walk(ROOT).filter((f) => !f.endsWith('package-lock.json') && !f.includes('/public/pdfjs/pdf.'));

const SECRET_PATTERNS: [string, RegExp][] = [
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9]{32,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['recovery key', /\bMK1(-[0-9A-HJKMNP-TV-Z]{5}){11}\b/],
];

describe('repository hygiene', () => {
  it('contains no secrets, private keys or recovery keys', () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const [label, re] of SECRET_PATTERNS) if (re.test(text)) hits.push(`${relative(ROOT, f)}: ${label}`);
    }
    expect(hits, `秘密情報らしき文字列: ${hits.join(', ')}。直し方: 削除し、必要なら .env（Git管理外）へ移す`).toEqual([]);
  });

  it('only .env.example is tracked by git', () => {
    let tracked: string[] = [];
    try {
      tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
    } catch {
      return; // not a git checkout (e.g. extracted archive)
    }
    const envs = tracked.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example'));
    expect(envs, `.env が追跡されている: ${envs.join(', ')}。直し方: git rm --cached して .gitignore を確認する`).toEqual([]);
  });

  it('the fixed-nonce test hook is only used by tests and vector generation', () => {
    const users = files.filter((f) => /nonceForTest/.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(users.filter((f) => !f.startsWith('tests/') && f !== 'src/core/crypto/envelope.ts' && !f.startsWith('docs/'))).toEqual([]);
  });

  it('app code does not write to the console (PII must never reach logs)', () => {
    const offenders = files.filter((f) => relative(ROOT, f).startsWith('src/') && /console\.(log|info|debug|warn|error)\(/.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(offenders, `console出力: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no remote CDN is referenced by the client (OCR/PDF engines are self-hosted)', () => {
    const offenders = files.filter((f) => relative(ROOT, f).startsWith('src/') && /cdn\.jsdelivr|unpkg\.com|cdnjs|googleapis\.com/.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});

describe('Trusted Types script URL allowlist', () => {
  it('accepts only the self-hosted engine files on this origin', async () => {
    const { isAllowedScriptURL } = await import('@/platform/web/trusted-types');
    const o = 'https://meishi.example.invalid';
    for (const ok of ['/ocr/worker.min.js', '/ocr/tesseract.min.js', '/pdfjs/pdf.worker.min.mjs', '/pdfjs/loader.mjs', '/sw.js', `${o}/ocr/worker.min.js`]) expect(isAllowedScriptURL(ok, o), ok).toBe(true);
    for (const bad of ['https://evil.example/ocr/worker.min.js', '/ocr/../evil.js', '/ocr/worker.min.js?x=1', '/evil.js', 'data:text/javascript,alert(1)', 'blob:https://meishi.example.invalid/abc', 'javascript:alert(1)', '//evil.example/sw.js']) expect(isAllowedScriptURL(bad, o), bad).toBe(false);
  });
});

describe('Vercel upload rules (.vercelignore)', () => {
  // Without an app-level file Vercel falls back to the repository-root .vercelignore, which ignores
  // /apps for the ANGLE Review deployment — the build then fails with `Missing script: "build:vercel"`.
  const rules = () => readFileSync(join(ROOT, '.vercelignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  it('the app has its own .vercelignore', () => {
    expect(() => rules(), 'apps/meishi-agent/.vercelignore がない。直し方: アプリ直下に .vercelignore を置く（無いとリポジトリ直下の /apps 除外が適用される）').not.toThrow();
  });
  it('excludes secrets and local data but keeps everything the build needs', () => {
    const r = rules();
    for (const must of ['.env', '.env.*', '.data/', 'node_modules/']) expect(r, `${must} を除外していない。直し方: .vercelignore に追加する`).toContain(must);
    expect(r, '.env.example まで除外されている').toContain('!.env.example');
    const needed = ['package.json', 'package-lock.json', 'vercel.json', 'app.json', 'src', 'server', 'scripts', 'public', 'assets'];
    for (const n of needed) expect(r.some((p) => p.replace(/^\/|\/$/g, '') === n || p === '/*' || p === '*'), `${n} がアップロード対象から外れている。直し方: .vercelignore から該当行を消す`).toBe(false);
  });
});
