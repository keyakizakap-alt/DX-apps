# プロジェクト方針

<!-- repo-harness:start -->

## 開発ハーネス（テスト・仕様書）

- 変更後は `npm test` を実行し、終了コード0を確認してから完了と報告する。
- 機能開発ごとに `docs/specs/<機能名>.md` を [雛形](docs/specs/_TEMPLATE.md) から作り、`## 完了条件` に客観的な判定基準（実行コマンド・生成ファイルなど）を書く。書き方は [docs/specs/README.md](docs/specs/README.md)。
- テストの assert メッセージには、何が起きたかと「直し方: …」を書く。
- 仕様書の形式は `npm run lint:specs` で検査される。失敗したら出力の「直し方」に従う。

<!-- repo-harness:end -->
