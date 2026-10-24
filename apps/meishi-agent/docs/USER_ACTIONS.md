# ユーザー側で必要な操作（このセッションでは実行できないもの）

Claude Code のセッションでは、外部サービスのアカウント作成・課金・公開・署名・実機操作は行っていません。以下は実施が必要な操作と理由です。

| # | 操作 | 理由 | 手順 |
|---|---|---|---|
| 1 | **Neon を Vercel Marketplace から追加**（無料プラン） | 同期サーバーのDB（PostgreSQL）。アカウント作成は本人の操作が必要 | Vercel ダッシュボード → Storage / Marketplace → Neon → Free プランで作成し、プロジェクト `meishi-agent` に接続 → `DATABASE_URL`（PgBouncer 経由のプール接続）が自動設定されることを確認。DB の地域は Vercel Functions の地域に近い所を選ぶ（下記 #4） |
| 2 | **Resend のアカウント作成・APIキー発行・送信ドメイン認証** | サインイン用確認コードのメール送信。`onboarding@resend.dev` は自分宛てにしか送れないため、他人が使うには独自ドメインの認証が必要 | resend.com でアカウント作成 → Domains で送信用ドメインを追加しDNS（SPF/DKIM）を設定 → API Keys で「Sending access」のキーを作成 → Vercel の環境変数に `RESEND_API_KEY`（Sensitive）、`MEISHI_MAIL_FROM`（例 `名刺管理 <no-reply@mail.あなたのドメイン>`）を登録 |
| 3 | **`MEISHI_SERVER_SECRET` の生成と保管** | OTP／メールHMACの鍵。漏れると確認コードの総当たり耐性が下がる | 32文字以上の乱数（例 `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`）を Vercel の環境変数（Sensitive, Production）に登録。Git やチャットに貼らない |
| 4 | **Vercel プロジェクトの作成とデプロイの許可** | 外部公開を伴うため、実行前にユーザーの明示的な許可が必要（CLAUDE.md） | GitHub 連携で新規プロジェクト → Root Directory `apps/meishi-agent`（`vercel.json` で Build Command `npm run build:vercel` 指定済み）→ 環境変数 `MEISHI_ALLOWED_ORIGINS=https://<本番ドメイン>`（例 `https://meishi-agent.vercel.app`）→ Settings → Functions で地域を Neon と同じ地域に設定 → デプロイ。**Hobby（無料）は非商用の個人利用のみ** |
| 4b | **公開後の確認** | 実際の配信環境（CDN の見出し・関数の起動・DB接続・メール到達）は自動試験では検証できない | `https://<本番ドメイン>/api/health` が `{"ok":true…}`、トップページの応答に `content-security-policy` があること、iPhone/Android のブラウザでサインイン→名刺登録→PCで表示までを確認。プレビュー用URLは Host 許可リスト外のため API が 421 になるのは正常 |
| 5 | （任意）**外部AIの有効化（無料）** | Groqのアカウント作成・APIキー発行・Zero Data Retentionの有効化は本人の操作が必要 | GroqCloudで無料プランに登録 → Data ControlsでZDRを有効化 → サービス契約を確認 → `GROQ_API_KEY`、`MEISHI_GROQ_ZDR_CONFIRMED=1`、`MEISHI_AI_TERMS_CONFIRMED=1` を設定（料金なし。無料枠の上限あり）。有料のClaude Haiku 5.5に切り替える場合は `MEISHI_AI_PROVIDER=anthropic` と `ANTHROPIC_API_KEY` |
| 6 | **Apple Developer Program 登録・EAS ログイン・署名** | iPhoneネイティブ版（SQLCipher・Keychain・Face ID・カメラ）の開発ビルド | `npx eas-cli@latest login` → `npx eas-cli@latest build --platform ios --profile development` → 実機にインストール（README参照） |
| 7 | **Android 開発ビルド** | Androidネイティブ版の検証 | `npx eas-cli@latest build --platform android --profile development`（またはAndroid Studioで `npx expo run:android`） |
| 8 | **ML Kit 日本語OCRのネイティブ統合と実機検証** | Expo公式プラグインがなく、開発ビルドと実機がないと検証できない（ADR-006） | 候補ライブラリを評価→Config Plugin追加→ `OcrEngine` 実装（`src/core/scan/ocr.ts` のインターフェース）→実機で架空名刺50枚を計測 |
| 9 | **実機チェックリストの実施** | iPhone/Androidの受入試験（50枚連続撮影、SQLCipher検査、相互復号、スイッチャー露出など） | `docs/PROGRESS.md` の「実機検証チェックリスト」に結果を記録 |
| 10 | **本番前のセキュリティレビュー** | 暗号・鍵管理は高リスク実装 | 第三者レビュー/ペネトレーションテスト |
