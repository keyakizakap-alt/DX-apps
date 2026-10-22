# 名刺管理（AI名刺管理エージェント）

iPhone・Android・PC ブラウザで名刺を取り込み、**端末内で暗号化**して人物・出会いの記録として整理し、**E2EE同期**で同じデータを安全に使うアプリです。Expo SDK 58（Expo Router + React Native Web）の単一コードベースと、暗号文だけを扱う同期サーバーで構成されています。

> 状態（2026-10-22）: **Web版は主要機能を自動試験で確認済み**（単体/統合/セキュリティ 196件（サーバー系は SQLite と PostgreSQL の両方）、ブラウザE2E 21件）。**Vercel＋Neon への公開準備は完了、デプロイは未実施**（[ADR-007](docs/ADR/007-hosting-vercel-neon.md)、手順は [USER_ACTIONS](docs/USER_ACTIONS.md)）。脅威分析は [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)。**iPhone/Androidネイティブ版は実装済みだが、ビルド・実機は未検証**です。詳細は [docs/PROGRESS.md](docs/PROGRESS.md)、セキュリティ判定は [docs/SECURITY_REPORT.md](docs/SECURITY_REPORT.md)。実名刺での本番利用は **No-Go**（理由は同レポート）。

このフォルダは `DX-apps` リポジトリ直下のアプリ（ANGLE Review）とは独立しています。依存・ビルド・デプロイは共有しません。

## できること
| 機能 | 内容 | 状態 |
|---|---|---|
| 保管庫 | 端末で鍵を生成、復旧キー（`MK1-…`）で別端末から復元、Webは任意で端末パスコード、自動ロック | Web検証済 |
| 取り込み | スマホのカメラ（ブラウザ）、画像/PDF選択、PCはドラッグ＆ドロップ、50枚/回、中断しても再開、失敗行だけ再試行 | Web検証済 |
| OCR | 端末内の日本語OCR（Tesseract.js、画像を外部に送らない）、原本と並べて確認・修正、項目ごとの「未確認」表示 | Web検証済（ネイティブは手入力） |
| 人物管理 | 所属履歴（異動・転職を保持）、出会いメモ、タグ、フォロー予定、検索（端末内） | Web検証済 |
| 重複整理 | 理由付きの候補、同姓同名・共有アドレスは低一致、統合は人が確認してから | Web検証済 |
| AI | 端末内のルール検索・フォロー提案・メール下書き（無料・端末から出ない）。外部AIは任意で **Groq無料プラン（gpt-oss-20b）**。既定OFF・毎回承認・送信本文を表示・**氏名/会社名は伏せ字にして送信** | Web検証済（実API未通信） |
| 同期 | 暗号文のみ同期、端末追加、オフライン編集、競合（両方残す）、削除の伝播、改ざん・巻き戻し拒否 | 検証済（サーバー＋Web） |
| データ管理 | 暗号化バックアップ（既定）、CSV（再認証＋件数確認）、端末/アカウント削除、操作履歴（個人情報なし） | Web検証済 |

## 構成
```
apps/meishi-agent/
├─ src/app/            画面（Expo Router, S00〜S15）
├─ src/core/           暗号・ドメイン・同期・AIポリシー（React非依存、Nodeで試験）
├─ src/platform/       OS別実装（*.web.ts: IndexedDB/WebCrypto/Tesseract、*.native.ts: SQLCipher/expo-crypto/SecureStore）
├─ src/ui/             共通UI部品・デザイントークン
├─ server/             同期サーバー（認証・所有者認可・暗号文のみ・外部AIプロキシ）。SQLite／PostgreSQL、Vercel 関数入口
├─ tests/              Vitest（unit / integration / security）
├─ e2e/run.mts         ブラウザE2E（実サーバー＋Webビルド）
└─ docs/               PLAN / PROGRESS / ADR / SECURITY_REPORT / USER_ACTIONS / requirements（元の指示パック）
```

## 動かし方

前提: Node.js **22.18 以上**（推奨 24 LTS）、Git。

### Windows（PowerShell）
```powershell
cd DX-apps\apps\meishi-agent
npm ci
npm run build:web:demo    # 架空データ読込ボタン付き（試用・試験用）。本番は npm run build:web
npm run server            # http://127.0.0.1:8787 を開く
```
- サインイン時の確認コードは、開発用としてサーバーを起動した PowerShell の画面に表示されます（本番では使えません）。
- 試験一式: `npm run check`（監査・型・lint・試験・ビルド・E2E）。E2E には Chromium が必要です: `npx playwright-core install chromium`。

### macOS / Linux
```bash
cd DX-apps/apps/meishi-agent
npm ci && npm run dev     # = build:web:demo + server
```

### iPhone / Android のブラウザで使う（Vercel＋Neon で公開）
WebCrypto（暗号化）は **HTTPS でのみ動作**します。`http://192.168.x.x` では起動できません。公開先は Vercel（無料の Hobby は非商用の個人利用のみ）＋ Neon（PostgreSQL）＋ Resend（確認コードのメール）です。
```bash
npm run build:vercel      # .vercel/output（静的ファイル＋/api 関数＋セキュリティ見出し）を生成
```
- Vercel のプロジェクト設定: Root Directory `apps/meishi-agent`（`vercel.json` に Build Command 指定済み）。必要な環境変数と手順は [docs/USER_ACTIONS.md](docs/USER_ACTIONS.md) #1〜#4b。
- 公開後、iPhone の Safari では共有 →「ホーム画面に追加」、Android の Chrome では「アプリをインストール」でアプリのように使えます（PWA）。
- 自前のサーバーで動かす場合は `npm run server`（`DATABASE_URL` があれば PostgreSQL、無ければ SQLite）。

### iPhone / Android ネイティブ版（開発ビルド, EAS）
Windows からでも EAS のクラウドで iOS をビルドできますが、**Apple Developer Program の登録・署名・実機が必要**です。
```powershell
npx eas-cli@latest login
npx eas-cli@latest build --platform ios --profile development       # 署名の設定を対話で行う
npx eas-cli@latest build --platform android --profile development
npx expo start --dev-client                                         # 実機の開発ビルドから接続
```
- `app.json` で `expo-sqlite` の `useSQLCipher: true` を有効化済み。Expo Go では SQLCipher・Face ID・暗号化ストアは動きません（開発ビルドが必要）。
- 同期サーバーのURLは `eas.json` の `EXPO_PUBLIC_SYNC_URL` で指定します。
- 実機での確認項目は [docs/PROGRESS.md](docs/PROGRESS.md) の「実機検証チェックリスト」。

## 環境変数（サーバー）
[.env.example](.env.example) を参照。秘密情報は Git に入れず、ホスティングの秘密設定に登録してください。外部AIは無料の **Groq（`GROQ_API_KEY`）** が既定で、`MEISHI_AI_TERMS_CONFIRMED=1`（規約確認済み）と `MEISHI_GROQ_ZDR_CONFIRMED=1`（Zero Data Retention有効化済み）がそろった場合だけ有効になります。Google Gemini の無料枠は規約で個人情報の送信が禁止されているため対応していません（[ADR-005](docs/ADR/005-ai-boundaries.md)）。

## コマンド
| コマンド | 内容 |
|---|---|
| `npm run typecheck` / `npm run lint` | 型検査 / ESLint（セキュリティ規則含む） |
| `npm test` | 単体・統合・セキュリティ試験（Vitest） |
| `npm run build:web` / `build:web:demo` | Webビルド（本番 / 架空データ読込ボタン付き） |
| `npm run server` | 同期サーバー＋Web配信 |
| `npm run test:e2e` | ブラウザE2E（先に `build:web:demo`） |
| `npm run audit` | 依存脆弱性ゲート |
| `npm run build:vercel` | Vercel 用の出力（本番Webビルド＋関数バンドル） |
| `node scripts/gen-icons.mjs` | `assets/brand/icon.svg` から全アイコンを再生成 |
| `npm run check` | 上記すべて（build:vercel を除く） |

## 公開・ストア申請用の文書（下書き）
プライバシーポリシー・利用規約・App Store／Google Play のデータ申告案・掲載文は [docs/legal/](docs/legal/README.md)。`〔要記入〕` を埋め、専門家の確認を受けてから公開してください。

## 守っていること（要点）
- 名刺の氏名・会社・メール・電話・画像・OCR本文は**端末で暗号化**してから保存・送信。サーバーは暗号文と最小限のメタデータのみ（試験でDBとログを走査して確認）。
- サインインだけでは復号できない（復旧キーが必要）。復旧キーを失い全端末を失うと復元できません。
- AIは読み取り専用の4ツールのみ。削除・統合・送信・共有・書き出しはできません。名刺やメモ内の指示文は命令として扱いません。
- 外部AIは既定OFF。使う場合も毎回、送信先・料金・データの扱い・項目・本文を確認して1回だけ許可します。氏名・会社名・部署は伏せ字にして送り、返答は端末内で実名に戻します（メール・電話・画像は送れない設計）。
- Webでは CSP・Trusted Types・クロスオリジン分離で不正スクリプトを防ぎ、画面を離れると内容を隠してロックします。復旧キーは既定で伏せ表示、コピーした値は60秒で消去します。
- 試験データはすべて架空（`.test`/`.example` ドメイン、0000番号）。
