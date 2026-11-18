// Dependency audit gate. Fails on any moderate+ advisory EXCEPT the reviewed build-time-only packages
// below, which ship with the Expo SDK 58 CLI/bundler toolchain and are not part of the web bundle
// or the sync server (verified: not present in dist/_expo/static, not imported by server/).
// Re-review this list whenever Expo is upgraded (docs/SECURITY_REPORT.md §依存関係).
import { execSync } from 'node:child_process';

const BUILD_TIME_ONLY = new Map([
  // node-forge was removed from this list on 2026-11-01: 1.4.2 fixes GHSA-86w9-cpqp-85rv and the
  // other <= 1.4.0 advisories, and the lockfile now resolves it.
  ['braces', 'metro file watcher (micromatch)'],
  // GHSA-3g3m-2fjr-6pw4 (glob 9.0.0 - 14.0.1) and GHSA-g3hv-75wg-m249 (minimatch < 11.0.1), published
  // 2026-10-30. Pulled in by @expo/cli, @expo/config, @expo/config-plugins, @expo/fingerprint and
  // @expo/metro-config; the fix needs a new Expo major. Verified 2026-11-01: absent from dist/ and
  // .vercel/output/, not imported by server/ or src/.
  ['glob', 'Expo CLI / config plugins / metro config file globbing'],
  ['minimatch', 'Expo fingerprint / config plugins (via glob)'],
  ['micromatch', 'metro file watcher'],
  ['uuid', 'xcode project parser used by config plugins'],
  ['xcode', 'iOS prebuild config plugins'],
]);

// Individual install paths reviewed as build-time only (the same package elsewhere still blocks).
// (empty: the Expo CLI's zod is overridden to 4.6.7 in package.json)
const BUILD_TIME_ONLY_NODES = new Map([]);

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
