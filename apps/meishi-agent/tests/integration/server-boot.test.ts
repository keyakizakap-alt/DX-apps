// Boots the real entrypoint exactly as `npm run server` does (Node type stripping, no bundler).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('server entrypoint', () => {
  it('starts with Node type stripping and answers /api/health with security headers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meishi-boot-'));
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'server/main.mts'], {
      cwd: join(__dirname, '..', '..'),
      env: { ...process.env, PORT: String(port), MEISHI_DB_PATH: join(dir, 'db.sqlite'), NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    try {
      let res: Response | undefined;
      for (let i = 0; i < 50 && !res; i++) {
        await new Promise((r) => setTimeout(r, 100));
        res = await fetch(`http://127.0.0.1:${port}/api/health`).catch(() => undefined);
      }
      expect(res?.status, `サーバーが起動しない。出力: ${output}。直し方: server/*.mts が型消去だけで動く構文か（erasableSyntaxOnly）を確認する`).toBe(200);
      expect(await res!.json()).toEqual({ ok: true, ai: false, aiDestination: null, aiInfo: null });
      expect(res!.headers.get('content-security-policy')).toContain("default-src 'self'");
    } finally {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to start in production without a server secret', async () => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'server/main.mts'], {
      cwd: join(__dirname, '..', '..'),
      env: { ...process.env, NODE_ENV: 'production', MEISHI_SERVER_SECRET: '', PORT: '0', MEISHI_DB_PATH: join(tmpdir(), `meishi-prod-${Date.now()}.sqlite`) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    const code = await new Promise<number | null>((r) => child.on('exit', r));
    expect(code).not.toBe(0);
    expect(err).toContain('MEISHI_SERVER_SECRET');
  });
});
