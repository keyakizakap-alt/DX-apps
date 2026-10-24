# セキュリティ試験結果（SEC-01〜20）

- 対象: `apps/meishi-agent` ブランチ `claude/meishi-agent-phase0` / Expo SDK 58.0.16 / 実行日 2026-10-21（強化版）、2026-10-22（Vercel＋Neon 対応で再試験）
- 脅威分析: [THREAT_MODEL.md](THREAT_MODEL.md)
- 実行環境: Linux コンテナ、Node.js 22.22.0、Chromium 141（Playwright 1.56.1）。**iPhone / Android 実機・Safari は未使用。**
- 判定: PASS（自動試験で確認）/ PARTIAL（一部環境のみ確認）/ NOT_TESTED（環境未提供）/ BLOCKED（ユーザー操作待ち）

| ID | 内容 | 判定 | 根拠（コマンド・試験） | 未解決・再試験条件 |
|---|---|---|---|---|
| SEC-01 | SQLCipherを鍵なしで復号できない | NOT_TESTED | 実装: `src/platform/sqlcipher-store.ts`（`PRAGMA key` 直後に `PRAGMA cipher_version` を確認し、無ければ**起動拒否**） | iOS/Android開発ビルドでDBファイルを取り出し `sqlite3` で開けないことを確認 |
| SEC-02 | 画像原本・一時ファイルが平文で残らない | PARTIAL | Web: 画像はAES-GCMでIndexedDB保存、表示用 blob URL は画面離脱で破棄。E2E「ロック・再読み込み後…」でIndexedDB全走査 | ネイティブ: 撮影一時ファイルの削除処理を追加済み（未実機検証）。OSバックアップ領域の検査が必要 |
| SEC-03 | VMK/APIキー/復旧キーが平文で残らない | PASS（Web） | E2E: localStorage・sessionStorage・cookie・IndexedDB を走査し氏名・メール・電話・復旧キーなし、端末鍵は `extractable=false`。`tests/security/repo-hygiene.test.ts`（秘密情報パターン・.env非追跡）。クライアントバンドルにサーバーコード/鍵名なし | ネイティブ Keychain/Keystore は未検証 |
| SEC-04 | AAD・nonce・鍵バージョン違反は復号失敗 | PASS | `tests/unit/crypto-vectors.test.ts`（改ざん・objectId/vaultId違い・鍵版・ヘッダ書換・用途違い・nonce非重複）、`sync-e2ee.test.ts`（サーバーによる再送・改ざんを拒否） | — |
| SEC-05 | iPhone↔Webの相互復号 | PARTIAL | WebCrypto と独立実装（@noble）でバイト一致する共通ベクトル。ネイティブアダプタは expo-crypto 代替で配線を検証 | 実機で `tests/unit/fixtures/envelope-v1-vectors.json` を expo-crypto で復号する試験を実行 |
| SEC-06 | サーバーへPII・原本・鍵を送らない | PASS | 統合試験＋E2EでサーバーDBの全テーブル・全列とサーバーログを走査し、氏名・メール・電話・復旧キー・タグ文字列が無いことを確認。**SQLite と PostgreSQL の両方**で実施 | Vercel のアクセスログ（IP・パス）は運用者確認。メールアドレスは送信時に Resend に渡る（文書化済み） |
| SEC-07 | 他ユーザーの暗号文を読めない・変更できない | PASS | `sync-e2ee.test.ts` SEC-07（pull 0件、blob 404、同一IDへのpushは自分の名前空間、他端末ID詐称は403）。両DBで実施 | — |
| SEC-08 | 認証成功だけでは復号できない | PASS | `sync-e2ee.test.ts` SEC-08、`vault.test.ts` | — |
| SEC-09 | 外部AI無効/未承認ならPII通信0 | PASS | `ai-boundaries.test.ts`（fetchモックで0件）、E2E（承認前の `/api/ai/*` 0件）。サーバー側も規約確認・ZDR確認が無いと無効（`ai-provider.test.ts`） | Groq/Anthropicとの実通信は未実施 |
| SEC-10 | 承認後はプレビュー項目のみ送信 | PASS | サーバーがSHA-256一致・1回限り・5分・アカウント限定で検証。E2Eで、外した会話メモが送信されないこと、送信項目＝表示項目、**氏名・会社名が伏せ字で実名が通信に出ないこと**、結果が端末内で実名に戻ることを確認 | 言い換えによる推定は残る（THREAT_MODEL 残余リスク5） |
| SEC-11 | 名刺内の「全連絡先を送信せよ」は実行されない | PASS | `ai-boundaries.test.ts` SEC-11（通信0・データ変化0）、content由来呼び出し拒否、禁止ツール9種すべて拒否 | — |
| SEC-12 | 重複は候補提示のみ・自動統合0 | PASS | `domain.test.ts`（同姓同名・共有アドレス・代表電話・転職）、E2E（判断後も人物数不変） | — |
| SEC-13 | 平文エクスポート・削除は再認証と確認 | PASS | E2E（復旧キー再入力→件数確認→CSV）、端末/アカウント削除は復旧キー＋「削除」入力、アカウント削除はサーバー側で10分以内のサインインを要求（`server-auth.test.ts`） | 個別の人物削除は確認のみ（再認証なし） |
| SEC-14 | ログ/監査に個人情報が出ない | PASS | 監査は {日時, 操作, 件数, 結果} のみ（型と実行時検査）、`ai-boundaries.test.ts` SEC-14、E2Eで監査画面を走査、サーバーログ走査、`src/` に console 出力なし | クラッシュレポートSDKは未導入（導入時に再評価） |
| SEC-15 | XSSで鍵・名刺を窃取されるリスク低減 | PARTIAL | CSP（`script-src 'self' 'wasm-unsafe-eval'`、inline/evalなし、`connect-src 'self'`、`frame-ancestors 'none'`）、**Trusted Types**（`require-trusted-types-for 'script'`、ポリシーは許可URLのみの `meishi`/`default` だけ、HTML挿入・eval系は全拒否）、**COOP/COEP（クロスオリジン分離）**、Zod `jitless`（evalを使わない）、ESLintで eval/innerHTML/dangerouslySetInnerHTML/localStorage 禁止、依存監査ゲート、pdf.js 6.4.299。E2Eで全画面のCSP/Trusted Types違反0件 | 解除中のメモリ上の平文はXSS成立時に読まれ得る（ブラウザの限界、画面で説明） |
| SEC-16 | オフライン更新→競合で両データ保持 | PASS | `sync-e2ee.test.ts`、E2E（両端末で編集→競合表示→両方残す→両端末に2件） | — |
| SEC-17 | 復旧キー紛失時の回復不能性を説明 | PASS | S00/S01 画面、ADR-003 | — |
| SEC-18 | ロック中の露出抑制 | PARTIAL | Web: タブ非表示でロック（既定ON）、非表示中は常に画面カバー、ロック中は氏名を描画しない（E2E）、復旧キーは既定で伏せ表示（E2E）。ネイティブ: `preventScreenCaptureAsync`（スクショ/録画防止、AndroidはFLAG_SECUREで履歴画面も空白）と iOS `enableAppSwitcherProtectionAsync(1.0)` を実装。通知機能なし | ネイティブの画面保護は実機未検証 |
| SEC-19 | テスト名刺・資格情報がCIに漏れない | PASS | 架空データのみ（`.test`/`.example` ドメイン、0000番号）、`.env.example` のみ、CIはシークレット不要 | — |
| SEC-20 | 第三者SDKによる予期せぬ外部送信がない | PARTIAL | Web: CSP `connect-src 'self'`、OCR/PDFエンジンは自己ホスト（CDN参照なしを試験）、解析SDKなし | ネイティブSDK（ML Kit等）導入時に通信監査が必要 |

## 追加の強化（2026-10-21）
| 対策 | 内容 | 検証 |
|---|---|---|
| DNSリバインディング | Hostヘッダー許可リスト（不一致は421） | `server-auth.test.ts` |
| Cookie | HTTPS時は `__Host-mc_session`（Path=/, Secure, HttpOnly, SameSite=Strict） | 実装・型検査（HTTPS環境での実測は未） |
| セッション | 無操作14日・最長30日で失効、端末ごとの失効 | `server-auth.test.ts` |
| OTP乱用 | 1分3回・1日10回/メール、IP単位、5回失敗で無効、10分で期限切れ | `server-auth.test.ts` |
| サービス妨害 | 全APIでIP 600回/分、ヘッダー20秒・リクエスト60秒のタイムアウト、ヘッダー16KB、許可メソッドのみ | `server-auth.test.ts`（メソッド） |
| 静的配信 | ドットファイル・ルート外への到達を拒否 | `server-auth.test.ts` |
| プロトタイプ汚染 | 厳格スキーマで未知キーを拒否 | `server-auth.test.ts` |
| パスコード | 10文字以上、繰り返し・連番・数字のみ短い・頻出語を拒否 | `client-hardening.test.ts` |
| クリップボード | 復旧キー・連絡先・下書きのコピーを60秒で消去 | 手動確認のみ |
| OCRワーカー | ロック時に破棄（画像をメモリに残さない） | 実装 |
| 監査ログ | ハッシュチェーンで改ざん（編集・削除・並べ替え）を検知し画面に表示 | `client-hardening.test.ts`、E2E |
| 入力耐性 | 暗号文・復旧キー・base64・OCR文字列をランダム入力で試験（型付きのエラーのみ） | `client-hardening.test.ts` |

## サーバーレス公開（Vercel＋Neon）向けの追加（2026-10-22）
| 対策 | 内容 | 検証 |
|---|---|---|
| OTP の二重使用 | 同じコードの同時検証5件 → 成功1件のみ（条件付き UPDATE） | `server-storage.test.ts`（SQLite／PostgreSQL） |
| アカウント重複 | 同じメールの同時初回サインイン → アカウント1件 | 同上 |
| 同期の上書き競合 | 2端末の同時 push → 一方 ok・他方 conflict、seq は重複しない（accounts 行ロック） | 同上 |
| 保管庫の差し替え | 異なる vault_id の同時登録 → 1件のみ成功、以後 409（原子的 upsert） | 同上 |
| アカウント削除 | 全表から関連行が消える（外部キーの連鎖削除） | 同上 |
| 本番設定の安全側エラー | 秘密鍵なし・メール未設定・http/パス付きオリジン → 起動拒否。Vercel では設定不足時 503 | `deploy-config.test.ts` |
| CDN の見出し | 静的ファイルにも同じ CSP・Trusted Types・COOP/COEP・HSTS（ワーカーは TT なし） | `deploy-config.test.ts`（ルート定義）。**Vercel 上の実測は未** |
| クライアントIP | `x-real-ip`（Vercel が上書き、公式記載）で回数制限 | `server-storage.test.ts` |
| 回数制限の範囲 | IP 毎分の制限はインスタンス単位（複数インスタンスでは緩くなる）。OTP 1日上限・5回失敗・容量上限は DB 判定 | 設計上の残余リスク（THREAT_MODEL） |

## 依存関係
- `npm run audit`（`scripts/audit-runtime.mjs`）: moderate以上の脆弱性のうち、**ビルド専用と確認済み**の `node-forge`（@expo/cli）・`braces`（metro）・`uuid`/`xcode`（config plugins）以外があれば失敗。これらはWebバンドルに含まれないことを確認済み。Expo更新時に再評価。
- zod: GHSA-mrhx-c7xc-m3w5（巨大な配列でメモリ枯渇, zod 4 の `$ZodArray`, 4.6.6 で修正, 2026-10-24 検出）。アプリ・サーバー・`@vercel/functions`・Expo CLI のすべてを 4.6.7 に統一（`package.json` の `overrides`。Expo CLI の zod 利用箇所は開発サーバーの DevTools スキーマのみで、読み込みを確認）。
- node-forge: GHSA-86w9-cpqp-85rv（high, <= 1.4.0, **2026-10-24 時点で修正版なし**）。RSA 署名検証の不備。Expo CLI の EAS Update 用コード署名でのみ使われ、本アプリは使用しない。Web とサーバーの配信物に含まれないことを確認（`dist/`・`.vercel/output` を検索して 0 件）。修正版が出たら更新し、許可リストから外す。
- pdf.js: GHSA-hq66-cqwq-w95j（悪意あるPDFで任意JS実行, 5.6.83〜6.2.107）を受け 6.4.299 へ更新（https://github.com/advisories/GHSA-hq66-cqwq-w95j 公式アドバイザリ）。`isEvalSupported:false` とCSPで多層防御。

## Go / No-Go
- **架空データでの試用（Web版、Vercel＋Neon）**: 条件付きGo（USER_ACTIONS #1〜#4b の設定と公開後確認が完了した場合。Hobby は非商用の個人利用のみ）。
- **実名刺の本番利用・外部公開・App Store配布**: **No-Go**。理由: SEC-01/05/18/20 の実機未検証、iOS日本語OCR（ML Kit）未統合、Vercel 上の実動作・監視が未確認、プライバシーポリシー等が下書き、第三者によるセキュリティレビュー未実施。
