# ANGLE Review LP

アプリと独立した静的サイト。VercelのRoot Directoryは `landing`、FrameworkはOther、Buildは `node build.mjs`、Outputは `public`。APIキー・データベース・記事データ・認証情報を使用しません。

`npm run build` で公開ファイルを生成。`npm start` で http://127.0.0.1:4174 を起動。本文は `site/index.html`、デザインは `site/lp.css`、操作例は `site/lp.js`。アプリへのリンクは https://agents-of-edit.vercel.app/ 。

## 公開先を作成する

接続中のVercelアカウントでは新規プロジェクト作成が403で拒否されました。既存アプリのプロジェクトは変更せず、LP用のプロジェクトを管理画面から作成してください。

1. VercelのAdd New → Projectで `keyakizakap-alt/DX-apps` をImport。
2. Project Nameを `angle-review-lp`、Root Directoryを `landing`、FrameworkをOtherに指定。
3. Build Commandは `node build.mjs`、Output Directoryは `public`。Install Commandは不要。環境変数も不要。
4. Deploy後に公開URLと表示・操作を確認する。

アプリとLPは同じリポジトリ内の独立プロジェクトです。LPはアプリのサーバー・AI設定・保存先を使いません。LPを単独で起動・ビルドできます。

移行中は旧 `/lp.html` を残しています。新しいLPの公開URLが確定してから、旧URLをリダイレクトへ変更し、アプリ側のLPファイルを削除することで移行を完了します。
