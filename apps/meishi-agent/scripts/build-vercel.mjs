// Vercel build (Build Output API v3): `npm run build:vercel` (the project's Build Command).
//   .vercel/output/static/            ← production web build (dist/, no DEMO loader)
//   .vercel/output/functions/api.func ← server/vercel.mts bundled with esbuild (Node.js function)
//   .vercel/output/config.json        ← routes (see scripts/vercel-output.mjs)
// `--skip-web` reuses an existing dist/.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleFunction, outputConfig } from './vercel-output.mjs';

const out = '.vercel/output';
if (!process.argv.includes('--skip-web')) {
  const r = spawnSync(process.execPath, ['scripts/build-web.mjs'], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!existsSync('dist/index.html')) throw new Error('dist/index.html is missing: run the web build first');
if (readFileSync('dist/index.html', 'utf8').length === 0) throw new Error('dist/index.html is empty');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('dist', join(out, 'static'), { recursive: true, filter: (src) => !/[\\/]\.[^\\/]+$/.test(src) }); // no dotfiles
await bundleFunction(join(out, 'functions/api.func'));
writeFileSync(join(out, 'config.json'), JSON.stringify(outputConfig(), null, 2));
console.log('built .vercel/output (static + api function + routes)');
