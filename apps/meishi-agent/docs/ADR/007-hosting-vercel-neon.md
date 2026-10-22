# ADR-007 公開先：Vercel（Hobby）＋ Neon（Free）＋ Resend（Free）

- 日付: 2026-10-22 / 状態: 採用（ユーザーが「Vercel無料＋Neon無料」を選択）。**デプロイ自体は未実施**（ユーザーの許可と外部アカウントが必要）

## 決定
- Web版の静的ファイルは Vercel の CDN、同期API（`/api/*`）は Vercel Function 1本（`server/vercel.mts` を esbuild で束ねて Build Output API v3 で出力。`scripts/build-vercel.mjs`）。
- DB は Neon の PostgreSQL（`DATABASE_URL`、PgBouncer 経由のプール接続）。ドライバーは `pg`。`@vercel/functions` の `attachDatabasePool` で待機接続を解放。
- 確認コードのメールは Resend の HTTPS API（`POST https://api.resend.com/emails`、Idempotency-Key＝チャレンジID）。
- 自前ホスティング用の Node サーバー（`npm run server`、SQLite または `DATABASE_URL`）は引き続き使える。

## 理由
- 無料で HTTPS 公開でき、iPhone/Android のブラウザから WebCrypto が使える。
- 既存の API 契約・認可・暗号文のみの設計をそのまま移せる（`createApp` を共有）。

## 変更点（サーバーレス対応）
| 課題 | 対応 |
|---|---|
| 永続ディスクがない | 保存先を非同期の `Sql` インターフェースにし、SQLite／PostgreSQL の2実装（同じ表・列） |
| 複数インスタンスが同時に同じアカウントを処理 | OTP は `consumed=0` 条件付き UPDATE で1回限り、アカウント作成は一意制約＋`ON CONFLICT DO NOTHING`、push は最初に accounts 行をロック、保管庫は異なる vault_id では上書きしない upsert |
| 静的ファイルにサーバーの見出しが付かない | `config.json` の routes で同じ CSP・Trusted Types・COOP/COEP・HSTS を付与（`server/headers.mts` を共有） |
| クライアントIP | Vercel が上書きする `x-real-ip` を使用（公式: 外部IPの X-Forwarded-For は転送しない） |
| 設定不備 | Vercel では常に本番規則（秘密鍵・実メール・https のオリジン必須）。不足時は API が 503 `server_misconfigured` |

## 検証
- サーバー試験（同期・認証・AI同意・容量・同時実行）を SQLite と PostgreSQL（PGlite）の両方で実行。
- 本番と同じ `pg` ドライバーを、PGlite のソケットサーバー越しに試験（型変換・プール・ROLLBACK）。
- バンドル済み関数を読み込み、設定なし→503、設定あり→`/api/health` 200・未認証 401・Host 不一致 421 を確認。

## 制約・未検証（デプロイ後に確認）
- **Vercel 上での実動作は未検証**（関数のルーティング、CDN の見出し、Neon への接続、メール到達）。USER_ACTIONS #4b の手順で確認する。
- 回数制限（IP 毎分600回など）は関数インスタンスのメモリ内。インスタンスが複数あると上限は緩くなる。OTP の1日上限・試行5回・容量上限は DB で判定するため有効。
- Vercel Hobby は**非商用の個人利用のみ**（[公式](https://vercel.com/docs/plans/hobby)）。業務・有償利用は Pro 以上へ。
- プレビュー配信の URL は Host 許可リスト外のため API は 421（意図どおり）。
- メールアドレスは送信のため Resend に平文で渡る（プライバシーポリシーに記載）。
