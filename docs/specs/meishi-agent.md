# AI名刺管理エージェント（apps/meishi-agent）

- ステータス: 実装中（Web版の主要機能は自動試験済み。iPhone/Androidネイティブ・実機は未検証）
- 関連: `apps/meishi-agent/docs/PROGRESS.md`, `apps/meishi-agent/docs/PLAN.md`

## 目的

iPhone・Android・PCブラウザで名刺を撮影/取込・OCR・整理し、E2EE同期で同じデータを安全に管理する。既存の ANGLE Review（リポジトリ直下）とは独立したアプリとして `apps/meishi-agent/` に置く。

## スコープ

- やること: Expo Router 単一アプリ（Web/iOS/Android）、暗号化保管庫、端末内OCR（Web）、人物・出会い・重複・検索、E2EE同期サーバー、AI（端末内＋同意制・伏せ字化した無料の外部LLM＝Groq）、多層のセキュリティ強化（`apps/meishi-agent/docs/THREAT_MODEL.md`）、試験とCI
- やらないこと: 本番デプロイ、課金・外部サービスのアカウント作成、iOS署名、既存 ANGLE Review のコード変更

## 完了条件

- [x] `npm test` がリポジトリ直下で終了コード0で終わる（既存アプリの試験を壊さない）
- [x] `cd apps/meishi-agent && npm run typecheck` が終了コード0で終わる
- [x] `cd apps/meishi-agent && npm run lint` が終了コード0で終わる
- [x] `cd apps/meishi-agent && npm test` が終了コード0で終わる
- [x] `cd apps/meishi-agent && npm run build:web:demo` で `apps/meishi-agent/dist/index.html` が生成される
- [x] `cd apps/meishi-agent && npm run test:e2e` の出力に `E2E: 21/21 passed` を含む
- [x] `cd apps/meishi-agent && npm run audit` の出力に `audit gate: OK` を含む
- [x] `cd apps/meishi-agent && npm test` の出力に `196 passed` を含む（サーバー系は SQLite と PostgreSQL の両方で実行）
- [x] `cd apps/meishi-agent && npm run build:vercel` で `apps/meishi-agent/.vercel/output/config.json` と `apps/meishi-agent/.vercel/output/functions/api.func/index.mjs` が生成される
- [x] `apps/meishi-agent/public/manifest.webmanifest` と `apps/meishi-agent/public/account-deletion.html` が存在する
- [ ] Vercel の本番URLで `/api/health` が `"ok":true` を返し、iPhone と Android のブラウザでサインイン→名刺登録→PCで表示ができたと `apps/meishi-agent/docs/PROGRESS.md` に記録されている
- [x] `apps/meishi-agent/docs/THREAT_MODEL.md` が存在する
- [ ] iPhone実機で `apps/meishi-agent/docs/PROGRESS.md` の「実機検証チェックリスト」の全項目が PASS と記録されている
- [ ] Android実機で `apps/meishi-agent/docs/PROGRESS.md` の「実機検証チェックリスト」の全項目が PASS と記録されている
