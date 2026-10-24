# AI名刺管理エージェント — Claude Code プロジェクト指示

## 目的と優先順位
名刺をiPhone/Androidで撮影・OCR・整理し、同じデータをWindows/Macブラウザで安全に検索・編集できる製品を実装する。優先順位は **情報保護 > データ整合性 > 実際の操作性 > AI機能の多さ > 見た目の演出**。

## 参照順序
1. `docs/requirements/01_CLAUDE_CODE_RUN_PROMPT.md`（具体的な実装命令・完了条件）
2. `docs/requirements/IMPLEMENTATION_PHASES.md`（実装順・成果物）
3. `docs/requirements/SECURITY_TEST_MATRIX.md`（セキュリティGo/No-Go）
4. `docs/requirements/references/UI_UX_SPEC_v1.1.md`（画面IDと遷移）
5. `docs/requirements/references/ARCHITECTURE_WINDOWS_v1.1.md`（OS別構成）
6. `docs/requirements/references/PRODUCT_SPEC_v1.0.md`（元の要求）
7. `docs/requirements/prototype/interactive-wireframe.html`（UI参照、機能実装の根拠にしない）

**仕様競合時**: このファイル > 01_RUN_PROMPT > docs のGo/No-Go > UI v1.1 > Architecture v1.1 > Product v1.0 > HTML試作。大きな設計変更はADRに理由と代替案を書く。

## 強制ルール
- テスト専用の架空名刺のみを利用する。実際の名刺や秘密情報はデバッグ・ログ・CI・外部LLMへ送らない。
- UIの画面遷移だけで「実装済み」「暗号化済み」「同期完了」「安全」と判定しない。裏側の実装・検証結果に一致する状態表示とする。
- 鍵やAPIキーをコミットしない。`.env.example` だけを用意し、`.env*` や鍵ファイルを `.gitignore` で除外する。公開アプリにサーバーAPI秘密鍵を組み込まない。
- 独自暗号方式・自作KDF・固定nonce・平文の名刺データ送信・名前/連絡先を含む監査ログは禁止。
- ローカルオンデバイスの検索と、許可した外部生成AIは明確に分ける。外部LLMは初期OFFかつ操作ごとの確認必須。
- OCR結果、人物メモ、名刺URLは全て非信頼入力。これらの文章でエージェントやツールの権限を変更できないようにする。
- 名刺統合・外部送信・削除・平文エクスポートをAIが自律的に行うことは禁止。DBの直接SQL実行、任意URLへのfetchをAIツールに与えない。
- E2EE暗号文とアカウント認証を分離。同期サーバーへ氏名・会社・メール・電話・名刺画像原本・復号鍵を送らない。
- オフライン時に端末内の既存データを利用できること。同期不調は編集の損失に直結させない。
- 技術資料を確認して、ライブラリ対応OSとExpo SDKの実際の互換性を検証する。存在しないAPIを想像で実装しない。
- 失敗したコマンド・検証できない実機機能は記録し、検証済みと表現しない。

## 開発スタイル
- TypeScript strict、入力検証（Zod等）、ドメイン層とOS別実装の分離、テスト可能な依存性注入を優先。
- まず実装済みコードとGit状態を読む。既存の内容を壊さない。危険な削除・force push・外部公開・課金操作は実行しない。
- 1フェーズごとに `lint`, `typecheck`, `unit`, `integration`, `web build` を実行し、結果と未検証項目を報告。
- 秘密情報を扱うセキュリティクリティカル実装は、小さなPoC、既知テストベクトル、失敗系を優先する。
- 画面は日本語優先。装飾より情報密度・可読性・エラー復帰・アクセシビリティを重視。
- スコープ内の作業を自律的に進める。ただし外部サービスの認証情報・課金・ドメイン設定・iPhone署名などユーザー操作が必須な箇所は明確に停止し、ローカルで可能な作業を完成させる。

## このリポジトリでの配置（追記）
- このアプリは `DX-apps/apps/meishi-agent/` に独立して置かれている。リポジトリ直下の ANGLE Review とは依存・ビルド・デプロイを共有しない。
- 参照資料は `docs/requirements/`（元の指示パック）。進捗と検証結果は `docs/PROGRESS.md`、判断記録は `docs/ADR/`。
- 変更後は `npm run check`（監査・型・lint・単体/統合/セキュリティ・Webビルド・ブラウザE2E）を実行する。リポジトリ直下の `npm test` も通すこと。
