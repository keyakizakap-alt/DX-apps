// Build Output API v3 pieces for Vercel, used by scripts/build-vercel.mjs and the tests.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { securityHeaders } from '../server/headers.mts';

/** Bundles server/vercel.mts into `<funcDir>/index.mjs` with its .vc-config.json. */
export async function bundleFunction(funcDir) {
  mkdirSync(funcDir, { recursive: true });
  await build({
    entryPoints: ['server/vercel.mts'],
    outfile: join(funcDir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    minify: false,
    sourcemap: false,
    legalComments: 'none',
    external: ['pg-native'], // optional native driver of `pg`; never used
    // CommonJS dependencies (pg) call require() for Node built-ins.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: 'warning',
  });
  writeFileSync(join(funcDir, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(
    join(funcDir, '.vc-config.json'),
    JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60 }, null, 2),
  );
}

/** Routing for config.json: security headers on every response, /api/* → function, SPA fallback. */
export function outputConfig() {
  const page = securityHeaders(true, false);
  const worker = securityHeaders(true, true); // OCR/PDF workers: CSP without Trusted Types
  return {
    version: 3,
    routes: [
      { src: '^/(?:ocr|pdfjs)/.*$', headers: worker, continue: true },
      { src: '^/(?!ocr/|pdfjs/).*$', headers: page, continue: true },
      { src: '^/(?:index\\.html)?$', headers: { 'cache-control': 'no-store' }, continue: true },
      { src: '^/api(?:/.*)?$', dest: '/api' },
      { handle: 'filesystem' },
      { src: '^/(?!api(?:/|$)).*$', dest: '/index.html', headers: { 'cache-control': 'no-store' } },
    ],
  };
}
