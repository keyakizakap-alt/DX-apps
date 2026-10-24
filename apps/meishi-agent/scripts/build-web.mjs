// Cross-platform (Windows PowerShell / macOS / Linux) web build.
//   node scripts/build-web.mjs          → production build (no DEMO data loader)
//   node scripts/build-web.mjs --demo   → build with the fictitious-data loader for tests/demos
import { spawnSync } from 'node:child_process';

const demo = process.argv.includes('--demo');
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(process.execPath, ['scripts/copy-vendor.mjs']);
run('npx', ['expo', 'export', '-p', 'web', '--output-dir', 'dist', '--clear'], { EXPO_PUBLIC_ENABLE_DEMO: demo ? '1' : '0', CI: '1' });
console.log(demo ? 'built dist/ WITH the DEMO loader (fictitious data) — do not deploy this build' : 'built dist/ (production, no DEMO loader)');
