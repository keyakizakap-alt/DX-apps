# 公開・ストア申請用の文書（下書き）

- 作成: 2026-10-22
- 状態: **下書き**。法的助言ではありません。`〔要記入〕` の箇所を埋め、公開前に専門家（弁護士等）の確認を受けてください。
- 前提: このリポジトリの実装（2026-10-22 時点）に基づく。実装を変えたら、これらの文書も更新すること。

| ファイル | 用途 |
|---|---|
| [PRIVACY_POLICY.md](PRIVACY_POLICY.md) | プライバシーポリシー（Web公開・両ストアで URL が必要） |
| [TERMS.md](TERMS.md) | 利用規約 |
| [APP_STORE_PRIVACY.md](APP_STORE_PRIVACY.md) | App Store Connect「App のプライバシー」回答案 |
| [GOOGLE_PLAY_DATA_SAFETY.md](GOOGLE_PLAY_DATA_SAFETY.md) | Google Play Console「データ セーフティ」回答案 |
| [STORE_LISTING.md](STORE_LISTING.md) | ストア掲載文・スクリーンショット計画・審査メモ |

## データの流れ（文書の根拠）
| データ | どこへ | 形 | 根拠（実装） |
|---|---|---|---|
| 名刺の氏名・会社・連絡先・画像・OCR本文・メモ | 端末内、同期サーバー（任意） | 端末で AES-256-GCM 暗号化。サーバーは復号できない | `src/core/crypto/`, `server/app.mts`（暗号文のみ受理） |
| メールアドレス | 同期サーバー → メール送信事業者（Resend） | サーバーは HMAC で保存。送信のため送信事業者に平文で渡る | `server/app.mts` `/api/auth/start`, `server/mailer.mts` |
| アカウントID・端末ID（ランダム）・端末名（例「iPhone アプリ」） | 同期サーバー | 平文（個人情報を含まない識別子） | `server/pg.mts` スキーマ |
| IPアドレス | 同期サーバー（メモリ上の回数制限のみ）、ホスティング事業者（Vercel）のアクセスログ | 平文 | `server/app.mts` `rateLimit` |
| 外部AIへの下書き依頼（任意・既定OFF） | 同期サーバー → AI提供元（Groq、ZDR 有効時のみ） | 氏名・会社・部署は伏せ字。メール・電話・画像は送らない。サーバーは保存しない | `src/core/ai/external.ts`, `server/ai-provider.mts` |
| 解析・広告・クラッシュ収集 | なし | — | 該当SDKなし |
