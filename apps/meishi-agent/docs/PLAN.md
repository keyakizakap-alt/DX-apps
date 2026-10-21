# 実装計画・リスク（AI名刺管理エージェント）

指示書: `docs/requirements/01_CLAUDE_CODE_RUN_PROMPT.md` / フェーズ定義: `docs/requirements/IMPLEMENTATION_PHASES.md`

## フェーズ別TODO（状態は 2026-10-21 時点。詳細結果は PROGRESS.md）

| Phase | TODO | 状態 |
|---|---|---|
| 0 | 既存リポジトリ確認・衝突回避（`apps/meishi-agent/` に独立配置、Vercel配信から除外） | 完了 |
| 0 | Expo SDK / SQLCipher / expo-crypto / ML Kit / Web OCR の公式情報確認 → ADR-001/006 | 完了 |
| 0 | 暗号形式v1・既知ベクトル・相互運用ベクトル・失敗系試験 → ADR-002 | 完了（iOS実機は未） |
| 0 | バックエンド選定 → ADR-004 | 完了（自前Node。本番先は未決） |
| 1 | ドメイン（Zod）・リポジトリ・暗号化ストア（IndexedDB / SQLCipher）・マイグレーション | 完了（SQLCipherは実機未検証） |
| 1 | S00〜S15 全画面・状態（空/読込/エラー/ロック/オフライン）・PCサイドバー/スマホ下部タブ | 完了（Web） |
| 2 | 取込（カメラ/ファイル/PDF/D&D）・50枚キュー・中断再開・失敗行再試行 | 完了（Web）。ネイティブ撮影は実機未検証 |
| 2 | 端末内日本語OCR（Web: Tesseract jpn）・レビュー・重複候補（理由付き、自動統合なし） | 完了（Web）。ML Kitは未統合 |
| 3 | 保管庫/復旧キー/端末追加/パスコード・同期API・所有者認可・revision競合・tombstone・オフライン | 完了（Web＋サーバー） |
| 4 | ローカルAI（検索/フォロー/下書き）・PolicyGateway・外部LLM同意フロー・監査 | 完了（実API通信は未） |
| 5 | ESLint・型・単体/統合/セキュリティ試験・ブラウザE2E・依存監査・CI・ドキュメント | 完了（実機・Safariは未） |
| 5 | iOS/Android 開発ビルド・実機受入試験 | **ユーザー操作待ち**（USER_ACTIONS） |

## 主要リスクと対策
| リスク | 影響 | 対策 / 現状 |
|---|---|---|
| iOSでSQLCipher未リンクのまま平文DBになる | 端末盗難時の漏えい | `PRAGMA cipher_version` で検査し未リンクなら起動拒否（実機試験待ち） |
| iOS expo-crypto と WebCrypto の非互換 | 同期データが開けない | 共通ベクトルで検証する手順を用意（実機待ち） |
| 日本語OCR精度 | 修正の手間 | 原本と並べて確認・項目別「未確認」表示。Web実測 5/7 完全一致（架空名刺1種）。実名刺での計測は未 |
| ブラウザXSS | 解除中データの窃取 | CSP・eval/innerHTML禁止・依存監査・ロック。残余リスクとして画面で説明 |
| 自前サーバーの運用 | 可用性・バックアップ | ADR-004。本番はマネージド移行を推奨 |
| 復旧キー紛失 | データ復元不能 | 作成時の2ブロック確認・保存導線・警告 |
