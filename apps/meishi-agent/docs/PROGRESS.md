# 進捗と検証結果

最終更新: 2026-10-21 / ブランチ: `claude/meishi-agent-phase0`
実行環境: Linux コンテナ, Node.js 22.22.0（CIは Node 24）, Chromium 141.0.7390.37（Playwright 1.56.1）, Expo SDK 58.0.16
**このセッションでは iPhone / Android 実機・Safari・macOS/Xcode は使用できない。** 下表の「未検証」はその理由による。

## 総括（実装済み / 未検証の区別）

| 区分 | 内容 |
|---|---|
| ✅ 実装し自動試験で確認 | 暗号コア（AES-256-GCM/HKDF、既知ベクトル）、保管庫・復旧キー・Webパスコード、IndexedDB暗号化ストア、S00〜S15 全画面（Web）、画像/PDF取込・50枚キュー・中断再開、端末内日本語OCR（Web/Tesseract）、レビュー・重複候補・明示的統合、人物/出会い/タグ/フォロー、ローカルAI（検索・フォロー・下書き）、外部AI同意フロー（偽AIで検証）、E2EE同期（2端末・競合・削除伝播・オフライン・改ざん/巻き戻し拒否）、所有者認可、監査ログ、CSV/暗号化バックアップ/削除（再認証）、CSP・Service Worker（オフライン起動） |
| ⚠️ 実装済み・未検証 | iOS/Android ネイティブ: SQLCipherストア、expo-crypto暗号、SecureStore鍵保管、Face ID解除、カメラ撮影・一時ファイル削除（型検査のみ、ビルド・実機未実施） |
| ⚠️ 実装済み・実環境未検証 | 外部AI（既定: Groq無料プラン `openai/gpt-oss-20b`、予備: Claude Haiku 5.5）の実通信（APIキー未提供のため偽AIで代替）、本番メール送信（開発用メーラーのみ）、HTTPS環境での `__Host-` Cookie |
| ❌ 未実装 | ネイティブ版 ML Kit 日本語OCR（手入力にフォールバック）、既存端末からのQR承認による端末追加、鍵ローテーションの再暗号化、ネイティブでのファイル書き出し、名刺の表裏自動ペアリング・四隅検出 |

## 実行コマンドと結果（2026-10-21）

| コマンド（`apps/meishi-agent` で実行） | 結果 |
|---|---|
| `npm run audit` | `audit gate: OK`（許可済みビルド専用: braces / node-forge / uuid。pdf.js 6.4.299 へ更新済み） |
| `npm run typecheck` | 成功（エラー0、`strict` + `noUncheckedIndexedAccess` + `erasableSyntaxOnly`） |
| `npm run lint` | 成功（エラー0・警告0） |
| `npm test`（Vitest） | **14ファイル / 116件 すべて成功**（強化後） |
| `npm run build:web:demo` | 成功（`dist/index.html`、単一バンドル 1.9MB、OCR資材 約8MB、pdf.js） |
| `npm run test:e2e` | **20/20 成功**（下記） |
| リポジトリ直下 `npm test` | **95件成功・失敗0**（既存 ANGLE Review の試験＋仕様書チェック。事前に `npm ci` が必要だった） |

### 単体・統合・セキュリティ試験（95件）
| ファイル | 件数 | 主な内容 |
|---|---|---|
| `tests/unit/crypto-vectors.test.ts` | 17 | GCM test case 16、RFC 5869、SHA-256、共通エンベロープベクトル（WebCrypto・ネイティブアダプタ）、改ざん/鍵違い/AAD違い/nonce非重複 |
| `tests/unit/vault.test.ts` | 7 | 復旧キーで別端末が開ける、別キー不可、チェックサム（全位置の1文字誤り）、パスコード二重ラップ |
| `tests/unit/domain.test.ts` | 11 | 日本語正規化、OCR項目抽出（和文/英文/命令文）、メールの空白補正、重複候補（同姓同名/共有アドレス/転職） |
| `tests/unit/indexeddb-store.test.ts` | 2 | 再オープン後の復号、保存領域に平文なし、ロック中の拒否 |
| `tests/unit/people.test.ts` | 3 | 別人判断、明示統合で履歴保持、削除 |
| `tests/integration/sync-e2ee.test.ts` | 9 | iPhone→PC復元→編集→反映、SEC-04/06/07/08/16、削除伝播、オフライン |
| `tests/integration/scan-review.test.ts` | 9 | 50枚上限・重複画像、中断再開・失敗行のみ再試行、50枚完走、転職の履歴保持、CSV/バックアップ |
| `tests/integration/controller.test.ts` | 6 | 確認前は使えない、ロック・誤キー遅延、パスコード、サインイン同期・2台目復元、外部AI既定OFF、端末消去 |
| `tests/integration/server-boot.test.ts` | 2 | Node型ストリップでの起動・CSP、本番で秘密未設定なら起動拒否 |
| `tests/security/ai-boundaries.test.ts` | 16 | SEC-09/10/11/14、ローカル検索/フォロー根拠/下書き、禁止ツール全拒否 |
| `tests/security/server-auth.test.ts` | 17 | 未認証拒否、CSRF、アカウント列挙防止、OTPロック/期限、HttpOnly Cookie、端末失効、再認証付き削除、CSP、非暗号Blob拒否、容量上限 |
| `tests/security/repo-hygiene.test.ts` | 6 | 秘密情報・復旧キー・.env の非混入、固定nonceの使用箇所、console出力なし、CDN参照なし、Trusted Typesの許可URL |
| `tests/security/ai-provider.test.ts` | 3 | 規約/ZDR未確認なら無効、Groqへの送信内容（無料モデル・strictスキーマ）、429/拒否/不正出力 |
| `tests/security/client-hardening.test.ts` | 8 | パスコード規則、監査ログの改ざん検知（編集・削除）、暗号文/復旧キー/base64/OCRのランダム入力試験、用途の取り違え |

### ブラウザE2E（20件, `e2e/run.mts`, 実サーバー＋Webビルド, Chromium）
PC 1280px: 作成・確認・DEMO架空データ / 検索・2ペイン・`/`ショートカット / 出会いメモ（離脱確認）・タグ / ローカルAI・外部AI既定OFF / 重複候補（自動統合なし）/ ロック・再読込で鍵や平文が残らない・誤キー遅延 / 設定・監査ログにPIIなし / CSV再認証・暗号化バックアップにPIIなし。
iPhoneサイズ 390px（UAエミュレーション）: 下部タブ・横スクロールなし・PNG/PDF取込・重複画像除外 / **端末内OCR→修正→保存→2枚目を同一人物に追加** / 再読込後パスコードで解除。
同期: **iPhone登録→PCを復旧キーで追加→PC編集→iPhone反映** / サーバーDBとログにPIIなし（実測）/ オフライン編集→復帰後送信 / **オフライン再読込（Service Worker）で閲覧** / 両端末編集→競合→両方残す / 外部AI（承認前通信0、外した項目は送信されない、送信1回）。
Androidサイズ 412px: 作成・下部タブ・横スクロールなし。アクセシビリティ: 主要7画面で操作要素に名前・高さ44px以上。コンソールエラー/CSP違反0。
スクリーンショット: `test-results/e2e/*.png`（Git管理外、CIではアーティファクト）。

### OCR実測（架空名刺1種、IPAGothic描画、Chromium、Tesseract.js 7.0.0 jpn best_int）
7項目中5項目が完全一致: 会社・部署・役職・メール・代表電話。誤り: 氏名「架空 花子」→「洒空花子」（信頼度5%で未確認表示）、携帯「090-0000-1001」→「099-0000-1901」。確認画面で人が修正して保存する流れはE2Eで確認。**実名刺・縦書き・照明条件での精度は未計測。**

## フェーズ別の記録

### Phase 0（技術検証）
- 既存資産: リポジトリ直下は別アプリ「ANGLE Review」（Vercel配信）。衝突回避のため `apps/meishi-agent/` に独立配置し、ルートの `.vercelignore` に `/apps` を追加。既存コードは変更していない。
- 公式情報で確認（2026-10-21）: Expo SDK 58 の `expo-sqlite` SQLCipher（iOS/Android/macOS、Web不可、未リンク時 PRAGMA key は無視）、`expo-crypto` AES-GCM（全OS、AAD可）、ML Kit 日本語（公式Pod）。→ ADR-001/006
- 暗号PoC: 既知ベクトル・相互運用ベクトル・失敗系を先に作成し合格。過程で**復旧キーの非正規表記（末尾パディングビット）を受理する不具合を試験で発見し修正**。
- バックエンド: Supabase はアカウント作成が必要なため、自前の最小サーバーで実装（ADR-004）。

### Phase 1〜2（UI・ローカルCRUD・取込/OCR）
- 全16画面を Expo Router で実装。E2E で発見して修正した不具合: 非同期ルート分割によりオフラインで未訪問画面に遷移できない → async routes 無効化＋Service Worker。`.mjs` のMIME誤りで pdf.js が読めない。外部AI承認画面で値のない項目のトグルが「オン」に見える。スイッチ/チェックボックスに `aria-checked` がない。同期状態チップとスイッチのタップ領域不足。
- OCR: `jpn+eng` 併用は tesseract.js 7.0.0 で初期化失敗のため `jpn` のみ。メール内の空白混入を補正し実測一致が 4/7→5/7 に改善。

### Phase 3（E2EE同期）
- revision による楽観的競合検出、tombstone、変更シーケンスによる差分取得、平文 `version` による巻き戻し拒否。競合解決で「この端末を採用」した版が他端末で巻き戻しと誤判定される不具合を試験で発見・修正。
- 容量上限（件数・画像）と 413 `quota` を追加。

### Phase 4（AI）
- 読み取り専用ツール4種のみ、content由来の呼び出し拒否、外部送信は型で項目制限＋同意ハッシュ（1回・5分・アカウント限定）。Claude API は公式SDK（`messages.parse` + Zod構造化出力）で実装、**実通信は未検証**。

### Phase 5（品質・配布）
- ESLint（Expo推奨＋eval/innerHTML/localStorage禁止）、依存監査ゲート、CI（`.github/workflows/meishi-agent.yml`: 監査→型→lint→試験→ビルド→日本語フォント導入→Chromium→E2E→成果物保存）。※ `actions/upload-artifact@v7` は非公式情報源（依存更新PR）で最新と確認、公式リリースページは未確認。
- **pdf.js の高深刻度脆弱性（GHSA-hq66-cqwq-w95j）を監査で検出し 6.4.299 へ更新**。API変更（`PDFDocumentProxy.destroy` 廃止）もE2Eで検出し修正。

### 追加ラウンド（2026-10-21）: セキュリティ強化と無料AI
依頼: 「セキュリティの構築は念入りに」「AIモデルはできる限り安く、無料で使えるもの」。

- **AI**:
  - 公式規約を確認し、外部AIの既定を **Groq 無料プラン（`openai/gpt-oss-20b`）** に変更した。契約で学習利用が禁止されており、ZDRを設定できる。
  - Gemini 無料枠は、規約で個人情報の送信が禁止されているため不採用。予備は有料で最安の Claude Haiku 5.5。
  - **氏名・会社名・部署を伏せ字にして送信し、端末内で戻す処理を既定ON**にした。E2Eで、送信本文と通信に実名が無いことを確認。（ADR-005）
- **サーバー**:
  - Host許可リスト、`__Host-` Cookie、無操作14日での失効、OTPの1日上限、IP全体のレート制限を追加。
  - タイムアウト、許可メソッド限定、ドットファイル拒否を追加。
  - Trusted Types、COOP/COEP、Permissions-Policy の拡張を追加。
- **端末**:
  - パスコード規則（10文字以上ほか）、復旧キーの伏せ表示、60秒で消えるクリップボードを追加。
  - 非表示時の画面カバー、ネイティブの画面キャプチャ防止とiOSアプリ切替画面のぼかしを追加。
  - ロック時にOCRワーカーを破棄、監査ログをハッシュチェーン化、ランダム入力試験を追加。
- **試験で見つけて直した問題**:
  - Trusted Types を有効にすると、次の3つが止まった:
    1. Zod の `new Function` による高速化（`jitless` で無効化）
    2. 自前のスクリプト読み込み（許可URLのみの専用ポリシーで対応）
    3. Tesseract のワーカーURL（同じ許可リストの `default` ポリシーで対応。ワーカー自身の応答には Trusted Types を課さない）
  - 監査ログの項目追加に合わせて SEC-14 の試験を更新した。
- **結果**: Vitest 116件、E2E 20/20（Trusted Types・COEP有効のまま、CSP違反0件）、lint 0件、監査ゲート OK。
- 脅威分析を [THREAT_MODEL.md](THREAT_MODEL.md)（STRIDE・残余リスク8項目）として追加した。

## 公開準備（2026-10-22）: Vercel＋Neon、PWA、ネイティブの不足分、申請文書
ユーザーの選択「Vercel無料＋Neon無料」に基づく（[ADR-007](ADR/007-hosting-vercel-neon.md)）。**デプロイは未実施**（外部アカウント作成と公開の許可が必要。[USER_ACTIONS](USER_ACTIONS.md) #1〜#4b）。

| 項目 | 状態 | 検証 |
|---|---|---|
| 保存先の非同期化（SQLite／PostgreSQL 同一スキーマ） | 実装済 | サーバー系5ファイルを SQLite と PostgreSQL（PGlite）の両方で実行（Vitest projects） |
| 同時実行の整合（OTP1回限り・アカウント重複防止・push の行ロック・保管庫の差し替え防止） | 実装済 | `server-storage.test.ts`（両DB） |
| 本番ドライバー `pg`（型変換・プール・ROLLBACK） | 実装済 | `pg-driver.test.ts`（PGlite ソケット越し） |
| Resend メール送信・本番設定の安全側エラー | 実装済 | `deploy-config.test.ts`（実APIへの送信は未実施） |
| Vercel 関数バンドル・ルート（CSP/TT/COOP/COEP/HSTS） | 実装済 | バンドルを読み込み 503/200/401/421 を確認。**Vercel 上の実動作は未検証** |
| PWA（マニフェスト・アイコン・ホーム画面追加のメタ情報・SW キャッシュ） | 実装済 | E2E「PWA」シナリオ。iPhone/Android 実機での「ホーム画面に追加」は未検証 |
| アプリアイコン（iOS/Android アダプティブ/モノクロ/PWA/favicon） | 作成済 | `assets/brand/icon.svg` → `node scripts/gen-icons.mjs` |
| ネイティブ: 書き出し（共有シート、一時ファイル削除） | 実装済 | 型検査のみ。**実機未検証** |
| ネイティブ: オンライン状態（NetInfo） | 実装済 | 型検査のみ。**実機未検証** |
| アカウント削除の Web 案内（Google Play 必須） | 作成済 | `public/account-deletion.html`、E2E で表示確認 |
| プライバシーポリシー・規約・ストア申告・掲載文 | **下書き** | `docs/legal/`。`〔要記入〕`と専門家確認が必要 |

- **結果**: Vitest 196件（SQLite 全件＋PostgreSQL のサーバー系）、E2E 21/21、lint 0件、型検査 OK、監査ゲート OK、`npm run build:vercel` で `.vercel/output` を生成。

## 画面ID ↔ ルート
| ID | ルート | ID | ルート |
|---|---|---|---|
| S00 | `/welcome`, `/sign-in` | S08 | `/people` |
| S01 | `/recover`（`?mode=restore` で復元） | S09 | `/people/[id]`（PCは一覧右ペインにも表示） |
| S02 | `/unlock` | S10 | `/people/[id]/encounter`（編集は `/people/[id]/edit`） |
| S03 | `/home` | S11 | `/assistant` |
| S04 | `/scan` | S12 | `/assistant/approve` |
| S05 | `/scan/queue` | S13 | `/settings/sync`, `/settings/conflicts` |
| S06 | `/scan/review` | S14 | `/settings`, `/settings/audit` |
| S07 | `/duplicates` | S15 | `/settings/export` |

## 実機検証チェックリスト（未実施 — 結果をここに記録）
| # | 項目 | iPhone | Android | Windows Chrome/Edge | Mac Safari |
|---|---|---|---|---|---|
| D1 | 開発ビルドのインストール・起動 | NOT_TESTED | NOT_TESTED | — | — |
| D2 | SQLCipher: DBファイルを取り出し鍵なしで開けない（SEC-01） | NOT_TESTED | NOT_TESTED | — | — |
| D3 | 共通ベクトルを expo-crypto で復号（SEC-05） | NOT_TESTED | NOT_TESTED | — | — |
| D4 | カメラで50枚連続撮影→中断（アプリ終了）→再開 | NOT_TESTED | NOT_TESTED | — | — |
| D5 | Face ID/指紋で解除、登録変更時は復旧キーを要求 | NOT_TESTED | NOT_TESTED | — | — |
| D6 | アプリスイッチャーに名刺が映らない（SEC-18） | NOT_TESTED | NOT_TESTED | — | — |
| D7 | Web版（HTTPS・Vercel）で作成・取込・OCR・同期・ホーム画面に追加 | NOT_TESTED（Safari） | NOT_TESTED（Chrome） | NOT_TESTED（ChromiumでE2E済） | NOT_TESTED |
| D8 | スクリーンリーダー（VoiceOver / TalkBack / NVDA） | NOT_TESTED | NOT_TESTED | NOT_TESTED | NOT_TESTED |

## 次の作業（優先順）
1. ユーザー操作: Neon・Resend・秘密鍵の登録と Vercel デプロイの許可（`docs/USER_ACTIONS.md` #1〜#4b）→ 実機ブラウザで D7 を実施。EAS/Apple 署名。
2. iOS/Android 開発ビルドで D1〜D6 を実施し、SQLCipher・expo-crypto 相互復号を確認。
3. ML Kit 日本語OCRのネイティブ統合（ADR-006）と、架空名刺セット（縦書き・英数字混在を含む）での精度計測。
4. iOSアプリスイッチャー保護、既存端末からの端末追加承認、鍵ローテーション。
