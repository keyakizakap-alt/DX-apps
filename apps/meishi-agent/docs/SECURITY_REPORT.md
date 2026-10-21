# セキュリティ試験結果（SEC-01〜20）

- 対象: `apps/meishi-agent` ブランチ `claude/meishi-agent-phase0` / Expo SDK 58.0.16 / 実行日 2026-10-21
- 実行環境: Linux コンテナ、Node.js 22.22.0、Chromium 141（Playwright 1.56.1）。**iPhone / Android 実機・Safari は未使用。**
- 判定: PASS（自動試験で確認）/ PARTIAL（一部環境のみ確認）/ NOT_TESTED（環境未提供）/ BLOCKED（ユーザー操作待ち）

| ID | 内容 | 判定 | 根拠（コマンド・試験） | 未解決・再試験条件 |
|---|---|---|---|---|
| SEC-01 | SQLCipherを鍵なしで復号できない | NOT_TESTED | 実装: `src/platform/sqlcipher-store.ts`（`PRAGMA key` 直後に `PRAGMA cipher_version` を確認し、無ければ**起動拒否**） | iOS/Android開発ビルドでDBファイルを取り出し `sqlite3` で開けないことを確認 |
| SEC-02 | 画像原本・一時ファイルが平文で残らない | PARTIAL | Web: 画像はAES-GCMでIndexedDB保存、表示用 blob URL は画面離脱で破棄。E2E「ロック・再読み込み後…」でIndexedDB全走査 | ネイティブ: 撮影一時ファイルの削除処理を追加済み（未実機検証）。OSバックアップ領域の検査が必要 |
| SEC-03 | VMK/APIキー/復旧キーが平文で残らない | PASS（Web） | E2E: localStorage・sessionStorage・cookie・IndexedDB を走査し氏名・メール・電話・復旧キーなし、端末鍵は `extractable=false`。`tests/security/repo-hygiene.test.ts`（秘密情報パターン・.env非追跡）。クライアントバンドルにサーバーコード/鍵名なし | ネイティブ Keychain/Keystore は未検証 |
| SEC-04 | AAD・nonce・鍵バージョン違反は復号失敗 | PASS | `tests/unit/crypto-vectors.test.ts`（改ざん・objectId/vaultId違い・鍵版・ヘッダ書換・用途違い・nonce非重複）、`sync-e2ee.test.ts`（サーバーによる再送・改ざんを拒否） | — |
| SEC-05 | iPhone↔Webの相互復号 | PARTIAL | WebCrypto と独立実装（@noble）でバイト一致する共通ベクトル。ネイティブアダプタは expo-crypto 代替で配線を検証 | 実機で `tests/unit/fixtures/envelope-v1-vectors.json` を expo-crypto で復号する試験を実行 |
| SEC-06 | サーバーへPII・原本・鍵を送らない | PASS | 統合試験＋E2EでサーバーSQLiteの全テーブル・全列とサーバーログを走査し、氏名・メール・電話・復旧キー・タグ文字列が無いことを確認 | 本番ホスティングのリバースプロキシ/アクセスログ設定は運用者確認 |
| SEC-07 | 他ユーザーの暗号文を読めない・変更できない | PASS | `sync-e2ee.test.ts` SEC-07（pull 0件、blob 404、同一IDへのpushは自分の名前空間、他端末ID詐称は403） | — |
| SEC-08 | 認証成功だけでは復号できない | PASS | `sync-e2ee.test.ts` SEC-08、`vault.test.ts` | — |
| SEC-09 | 外部AI無効/未承認ならPII通信0 | PASS | `ai-boundaries.test.ts`（fetchモックで0件）、E2E（承認前の `/api/ai/*` 0件） | 実APIキーでの通信は未実施 |
| SEC-10 | 承認後はプレビュー項目のみ送信 | PASS | サーバーがSHA-256一致・1回限り・5分・アカウント限定で検証。E2Eで外した会話メモが送信されないこと、送信項目＝表示項目を確認 | — |
| SEC-11 | 名刺内の「全連絡先を送信せよ」は実行されない | PASS | `ai-boundaries.test.ts` SEC-11（通信0・データ変化0）、content由来呼び出し拒否、禁止ツール9種すべて拒否 | — |
| SEC-12 | 重複は候補提示のみ・自動統合0 | PASS | `domain.test.ts`（同姓同名・共有アドレス・代表電話・転職）、E2E（判断後も人物数不変） | — |
| SEC-13 | 平文エクスポート・削除は再認証と確認 | PASS | E2E（復旧キー再入力→件数確認→CSV）、端末/アカウント削除は復旧キー＋「削除」入力、アカウント削除はサーバー側で10分以内のサインインを要求（`server-auth.test.ts`） | 個別の人物削除は確認のみ（再認証なし） |
| SEC-14 | ログ/監査に個人情報が出ない | PASS | 監査は {日時, 操作, 件数, 結果} のみ（型と実行時検査）、`ai-boundaries.test.ts` SEC-14、E2Eで監査画面を走査、サーバーログ走査、`src/` に console 出力なし | クラッシュレポートSDKは未導入（導入時に再評価） |
| SEC-15 | XSSで鍵・名刺を窃取されるリスク低減 | PARTIAL | CSP（`script-src 'self' 'wasm-unsafe-eval'`、inline/evalなし、`connect-src 'self'`、`frame-ancestors 'none'`）、ESLintで eval/innerHTML/dangerouslySetInnerHTML/localStorage 禁止、依存監査ゲート、pdf.js を脆弱性修正版 6.4.299 へ更新 | 解除中のメモリ上の平文はXSS成立時に読まれ得る（ブラウザの限界、画面で説明） |
| SEC-16 | オフライン更新→競合で両データ保持 | PASS | `sync-e2ee.test.ts`、E2E（両端末で編集→競合表示→両方残す→両端末に2件） | — |
| SEC-17 | 復旧キー紛失時の回復不能性を説明 | PASS | S00/S01 画面、ADR-003 | — |
| SEC-18 | ロック中の露出抑制 | PARTIAL | Web: タブ非表示でロック（設定・既定ON）、ロック中は氏名を描画しない（E2E）。通知機能なし | iOSアプリスイッチャーのスナップショット対策は未実装・未検証 |
| SEC-19 | テスト名刺・資格情報がCIに漏れない | PASS | 架空データのみ（`.test`/`.example` ドメイン、0000番号）、`.env.example` のみ、CIはシークレット不要 | — |
| SEC-20 | 第三者SDKによる予期せぬ外部送信がない | PARTIAL | Web: CSP `connect-src 'self'`、OCR/PDFエンジンは自己ホスト（CDN参照なしを試験）、解析SDKなし | ネイティブSDK（ML Kit等）導入時に通信監査が必要 |

## 依存関係
- `npm run audit`（`scripts/audit-runtime.mjs`）: moderate以上の脆弱性のうち、**ビルド専用と確認済み**の `node-forge`（@expo/cli）・`braces`（metro）・`uuid`/`xcode`（config plugins）以外があれば失敗。これらはWebバンドルに含まれないことを確認済み。Expo更新時に再評価。
- pdf.js: GHSA-hq66-cqwq-w95j（悪意あるPDFで任意JS実行, 5.6.83〜6.2.107）を受け 6.4.299 へ更新（https://github.com/advisories/GHSA-hq66-cqwq-w95j 公式アドバイザリ）。`isEvalSupported:false` とCSPで多層防御。

## Go / No-Go
- **架空データでの社内試用（Web版、HTTPS配信）**: 条件付きGo（本番メール送信・HTTPS・バックアップ運用を整えた場合）。
- **実名刺の本番利用・外部公開・App Store配布**: **No-Go**。理由: SEC-01/05/18/20 の実機未検証、iOS日本語OCR（ML Kit）未統合、本番ホスティング/メール/監視が未構築、第三者によるセキュリティレビュー未実施。
