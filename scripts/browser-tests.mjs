// Runs every browser test against a local development server, one file at a time.
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const files = (await readdir(new URL('tests/', root))).filter(file => /(^|-)browser\.mjs$/.test(file)).sort();
const only = process.argv.slice(2);
const selected = only.length ? files.filter(file => only.some(name => file.includes(name))) : files;
const server = spawn(process.execPath, ['scripts/dev.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('development server did not start')), 20000);
  server.stdout.on('data', chunk => { if (String(chunk).includes('127.0.0.1:4173')) { clearTimeout(timer); resolve(); } });
  server.on('exit', code => { clearTimeout(timer); reject(new Error(`development server exited (${code})`)); });
});
// Chromium drops non-ASCII download names when no locale is set, so default to UTF-8.
const env = { ...process.env, LANG: process.env.LANG || 'C.UTF-8' };
const failed = [];
for (const file of selected) {
  const code = await new Promise(resolve => spawn(process.execPath, ['tests/' + file], { cwd: root, env, stdio: 'inherit' }).on('exit', resolve));
  console.log(`${code === 0 ? 'ok' : 'FAILED'} - ${file}`);
  if (code !== 0) failed.push(file);
}
server.kill();
if (failed.length) { console.error(`${failed.length} browser test file(s) failed: ${failed.join(', ')}`); process.exit(1); }
