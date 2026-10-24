// Dependency audit gate. Fails on any moderate+ advisory EXCEPT the reviewed build-time-only packages
// below, which ship with the Expo SDK 58 CLI/bundler toolchain and are not part of the web bundle
// or the sync server (verified: not present in dist/_expo/static, not imported by server/).
// Re-review this list whenever Expo is upgraded (docs/SECURITY_REPORT.md §依存関係).
import { execSync } from 'node:child_process';

const BUILD_TIME_ONLY = new Map([
  ['node-forge', 'expo CLI code-signing certificates (@expo/cli)'],
  ['braces', 'metro file watcher (micromatch)'],
  ['micromatch', 'metro file watcher'],
  ['uuid', 'xcode project parser used by config plugins'],
  ['xcode', 'iOS prebuild config plugins'],
]);

// Individual install paths reviewed as build-time only (the same package elsewhere still blocks).
const BUILD_TIME_ONLY_NODES = new Map([
  // zod 3 used by @expo/cli (hoisted under expo/). App code and the server import the top-level zod 4.
  ['node_modules/expo/node_modules/zod', 'zod 3 inside the Expo CLI (GHSA-mrhx-c7xc-m3w5 is about zod 4 $ZodArray)'],
]);

let report;
try {
  report = JSON.parse(execSync('npm audit --omit=dev --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch (e) {
  report = JSON.parse(e.stdout); // npm audit exits non-zero when vulnerabilities exist
}
const root = new Set(
  Object.entries(report.vulnerabilities ?? {})
    .filter(([, v]) => v.via.some((x) => typeof x === 'object') && ['moderate', 'high', 'critical'].includes(v.severity))
    .map(([name]) => name),
);
const allowed = (n) => BUILD_TIME_ONLY.has(n) || (report.vulnerabilities[n].nodes ?? []).every((node) => BUILD_TIME_ONLY_NODES.has(node));
const reason = (n) => BUILD_TIME_ONLY.get(n) ?? report.vulnerabilities[n].nodes.map((node) => BUILD_TIME_ONLY_NODES.get(node)).join('; ');
const unexpected = [...root].filter((n) => !allowed(n));
for (const n of root) console.log(`${allowed(n) ? 'allowed (build-time only)' : 'BLOCKING'}: ${n}${allowed(n) ? ` — ${reason(n)}` : ''}`);
if (unexpected.length) {
  console.error(`\n実行時に含まれうる依存に脆弱性があります: ${unexpected.join(', ')}\n直し方: npm audit で修正版を確認して更新する。ビルド専用と確認できた場合のみ BUILD_TIME_ONLY に理由付きで追加する。`);
  process.exit(1);
}
console.log('audit gate: OK');
