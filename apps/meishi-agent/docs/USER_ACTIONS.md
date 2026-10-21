# ユーザー側で必要な操作（このセッションでは実行できないもの）

Claude Code のセッションでは、外部サービスのアカウント作成・課金・公開・署名・実機操作は行っていません。以下は実施が必要な操作と理由です。

| # | 操作 | 理由 | 手順 |
|---|---|---|---|
| 1 | **HTTPSでのWeb公開先を決めて配置**（例: Cloud Run / VM / Fly.io 等） | iPhone・Androidのブラウザから使うには HTTPS が必須（WebCrypto は安全なコンテキストでのみ動作） | `npm run build:web` → `server/` と `dist/` を配置し、`.env.example` の変数を設定。`NODE_ENV=production` で起動 |
| 2 | **メール送信サービスの契約と送信元ドメイン認証** | 本番のOTPメール送信。現在は開発用（コンソール出力）のみで、本番起動は拒否される | 送信サービスを選定し `server/main.mts` の `Mailer` を実装・差し替え（APIキーはホスティングの秘密設定へ） |
| 3 | **`MEISHI_SERVER_SECRET` の生成と保管** | OTP/メールHMACの鍵 | 32文字以上の乱数をホスティングの秘密設定に登録（Gitに入れない） |
| 4 | **サーバーDBのバックアップ・監視** | 自前サーバー採用のため（ADR-004） | SQLiteファイルの定期バックアップ（暗号文のみだが可用性のため）、ディスク容量監視 |
| 5 | （任意）**外部AIの有効化** | Anthropic APIキーと、組織としてのデータ保持・学習利用条件の確認が必要 | 条件確認後に `ANTHROPIC_API_KEY` と `MEISHI_AI_TERMS_CONFIRMED=1` を設定。利用料金が発生 |
| 6 | **Apple Developer Program 登録・EAS ログイン・署名** | iPhoneネイティブ版（SQLCipher・Keychain・Face ID・カメラ）の開発ビルド | `npx eas-cli@latest login` → `npx eas-cli@latest build --platform ios --profile development` → 実機にインストール（README参照） |
| 7 | **Android 開発ビルド** | Androidネイティブ版の検証 | `npx eas-cli@latest build --platform android --profile development`（またはAndroid Studioで `npx expo run:android`） |
| 8 | **ML Kit 日本語OCRのネイティブ統合と実機検証** | Expo公式プラグインがなく、開発ビルドと実機がないと検証できない（ADR-006） | 候補ライブラリを評価→Config Plugin追加→ `OcrEngine` 実装（`src/core/scan/ocr.ts` のインターフェース）→実機で架空名刺50枚を計測 |
| 9 | **実機チェックリストの実施** | iPhone/Androidの受入試験（50枚連続撮影、SQLCipher検査、相互復号、スイッチャー露出など） | `docs/PROGRESS.md` の「実機検証チェックリスト」に結果を記録 |
| 10 | **本番前のセキュリティレビュー** | 暗号・鍵管理は高リスク実装 | 第三者レビュー/ペネトレーションテスト |
