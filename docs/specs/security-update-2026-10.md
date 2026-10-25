# 依存パッケージの最新化とリマインダー認証の強化（2026-10）

- ステータス: 完了
- 関連: ブランチ `claude/security-update-2026-10`

## 目的

開発用依存を最新版にそろえ、定期実行（cron）用シークレットの比較を応答時間から推測できない方式に変える。

## スコープ

- やること: `@electric-sql/pglite` 0.5.11・`playwright-core` 1.64.1 への更新、`server/reminders.mjs` の Authorization 比較を固定長ダイジェストの比較に変更
- やらないこと: 画面・API の仕様変更

## Node.js ランタイム（2026-10-21 セキュリティリリース）

Node.js 公式が 2026-10-21 に High 4件を含む10件の脆弱性を修正した（修正版: 22.23.4 / 24.22.1 / 26.12.1）。修正版より古い Node.js で開発・CI・デプロイが動かないよう、`package.json` の `engines.node` で下限を指定する。`.npmrc` の `engine-strict=true` により、古い版では `npm ci` が失敗する。Vercel は `engines` の範囲内の最新版（24系）でデプロイする。

## 完了条件

- [x] `npm test` が終了コード0で終わる
- [x] `npm run lint:specs` が終了コード0で終わる
- [x] `node scripts/browser-tests.mjs` が終了コード0で終わる
- [x] `npm audit --audit-level=high` が終了コード0で終わる
- [x] `server/reminders.mjs` に `sameSecret` を含む
- [x] `tests/workspace.test.mjs` に誤ったシークレットを拒否するテストを含む
- [x] `package.json` の `engines.node` が `>=24.22.1 <25` である
- [x] `.npmrc` に `engine-strict=true` を含む
- [x] Node.js 24.22.1 で `npm ci` と `npm test` が終了コード0で終わる
- [x] `.github/workflows/ci.yml` の setup-node に `check-latest: true` を含む
- [x] `apps/meishi-agent/package.json` の `engines.node` が `^22.23.4 || ^24.22.1` で、`apps/meishi-agent/.npmrc` に `engine-strict=true` を含む
- [x] `.github/workflows/meishi-agent.yml` の setup-node に `check-latest: true` を含む
- [x] Node.js 24.22.1 で `cd apps/meishi-agent && npm run check` が終了コード0で終わる
- [x] `.github/workflows/*.yml` の `uses:` がすべてコミット SHA で固定されている
- [x] `.github/workflows/codeql.yml` が存在し、`.github/dependabot.yml` が `/apps/meishi-agent` を含む
