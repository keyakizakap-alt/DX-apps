# 実装フェーズ / DoD / 依存関係

## 進行の原則
- 後工程を仮実装して見せることより、データ保護の基盤から進める。
- クリティカルなPoCが成立しない場合、プレースホルダーは **DEMO / 未実装** と表示。実人物情報の入力はロック。
- すべてのフェーズで `docs/PROGRESS.md` に検証方法・結果・残課題を記録。

| Phase | 実装成果 | 依存 | 完了ゲート |
|---|---|---|---|
| 0 | 技術PoC/ADR/脅威分析 | なし | iOS日本語OCR・SQLCipher・iOS/Web暗号相互運用の成立見込みと検証手段が具体的 |
| 1 | Expo universal画面、フォーム/DB/検索 | 0 | S00～S15の遷移と状態、架空データCRUD、レスポンシブWeb、入力検証 |
| 2 | ネイティブ連続撮影、OCR、レビュー、キュー、重複候補 | 1 | 50枚の取り込み/復帰・日本語の認識と修正・別人誤統合なし |
| 3 | Vault/鍵復旧、RLS暗号文同期、追加端末、競合 | 0,1,2 | iPhone↔PCの鍵復旧/同期と非平文が実測で確認できる |
| 4 | ローカルAI検索、連絡下書き、外部LLM承認 | 1,3 | 未承認PII送信ゼロ、ツール認可、監査、プロンプト注入拒否 |
| 5 | QA、パフォーマンス、Windows/iOS起動ガイド | 0-4 |セキュリティGo/No-Go、CI、リリース阻害事項の一覧 |

## 具体的な開発タスク例

### Phase 0
1. 現行Expo SDK・native module対応を公式情報から固定し `docs/ADR/001-stack.md` を作成。
2. 鍵/暗号形式v1の明文化。例: `vaultVersion`, `keyVersion`, `recordId`, `revision`, `nonce`, `aad`, `ciphertext`, `tag`。
3. WebCrypto・Native双方の暗号互換テストベクトル、誤鍵/改ざん失敗ケース。
4. iOS Dev BuildとML Kit日本語・SQLCipher PoC。iPhone実機が未接続なら検証未実施と明記。
5. バックエンド選択ADRにコスト・可用性・運用負荷・RLS運用・障害時のデータ損失対策を記載。

### Phase 1
1. Domain: Contact/Card/Organization/Affiliation/Encounter/Task + Zod検証。
2. `ContactRepository`, `CardRepository`, `Vault`, `OCRAdapter`, `SyncAdapter` などインターフェースとOS別実装を分離。
3. 下部5タブ / PCサイドバー+2ペインと、検索結果一覧を作る。
4. S00-S15のルート/ロック分岐/空画面/Loading/Error/Offlineを整える。
5. モックは `DEMO` のみに接続し、正式保存経路はPoCゲート成立後に開ける。

### Phase 2
1. カメラ権限拒否、撮り直し、表裏ペアリング、失敗行再試行。
2. OCRはローカル日本語で、bbox/confidence/未確定を原データと分けて保存。
3. 補正/縦横回転/リサイズ/EXIF対策、巨大画像に対するメモリ上限。
4. 表記揺れ検索、重複候補と説明、手動承認。
5. OCR性能をオフラインの架空名刺セットで測定し、誤り例を文書化。

### Phase 3
1. VaultをiOSとWebで生成/復旧。サーバー認証と復号キー独立。
2. 同期は `create/update/delete`・revision/ETag・tombstone、暗号文を送る。
3. 所有者本人以外からは取得不能。クロスユーザー・競合・再接続を自動試験。
4. バックアップ暗号文、復旧キー損失、他端末失効/既にオフライン復号済みデータの限界を説明。

### Phase 4
1. ローカル検索中心のAIツールと根拠表示。
2. 外部LLMは1リクエスト1承認、内容ハッシュを確認してから限定フィールド送信。
3. 外部送信しない拒否導線、切断/タイムアウト/モデルエラー時の復旧。
4. prompt injection / indirect prompt injection、モデルの情報推測を事実に保存しないテスト。

### Phase 5
1. Chrome/Edge/Safari とiOS/Android実機または未検証を列挙。
2. アクセシビリティ、ゼロ件/多件数、オフライン、同期競合、削除伝播。
3. `README.md`, `.env.example`, `docs/ADR`, `docs/PROGRESS`, `docs/SECURITY_REPORT` を納品。

## 推奨ディレクトリ（実装時に決定）

```text
src/app/                     # Expo Router各画面
src/features/{scan,ocr,people,ai,sync,security}/
src/domain/{entities,policy,schemas}/
src/storage/{native,web}/   # SQLCipher / encrypted IndexedDB
src/crypto/{native,web,shared}/
src/services/{sync,auth,audit}/
server/                      # 認証・所有者認可・暗号文同期・AIプロキシ
packages/{types,ui}/        # 必要時だけ。過度な分割を避ける
__tests__/{unit,integration,security}/
e2e/                         # Webの操作テスト
```

## リリース判定
- UIのモック試作と、**ユーザーデータの安全な扱いができる製品**を区別する。
- 暗号・鍵・RLS/IDOR・本物のiPhone撮影/OCR・復元が未検証なら外部公開禁止。
