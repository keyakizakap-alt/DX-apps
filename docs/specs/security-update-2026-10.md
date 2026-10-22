# 依存パッケージの最新化とリマインダー認証の強化（2026-10）

- ステータス: 完了
- 関連: ブランチ `claude/security-update-2026-10`

## 目的

開発用依存を最新版にそろえ、定期実行（cron）用シークレットの比較を応答時間から推測できない方式に変える。

## スコープ

- やること: `@electric-sql/pglite` 0.5.11・`playwright-core` 1.64.1 への更新、`server/reminders.mjs` の Authorization 比較を固定長ダイジェストの比較に変更
- やらないこと: 画面・API の仕様変更

## 完了条件

- [x] `npm test` が終了コード0で終わる
- [x] `npm run lint:specs` が終了コード0で終わる
- [x] `node scripts/browser-tests.mjs` が終了コード0で終わる
- [x] `npm audit --audit-level=high` が終了コード0で終わる
- [x] `server/reminders.mjs` に `sameSecret` を含む
- [x] `tests/workspace.test.mjs` に誤ったシークレットを拒否するテストを含む
