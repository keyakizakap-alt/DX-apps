# Claude Code向け AI名刺管理エージェント 実装指示パック

対象：**iPhone / Android アプリ＋Windows / Macブラウザ**。本ファイル一式は「Claude Codeに実装させるための指示・仕様・UI試作資料」であり、**動作完成したアプリではありません**。

## ファイル

| ファイル | 役割 |
|---|---|
| `01_CLAUDE_CODE_RUN_PROMPT.md` | **Claude Codeに読ませるメイン指示**（実装・テスト・完了判定） |
| `CLAUDE.md` | プロジェクト共通のセキュリティ/実装ルール |
| `docs/IMPLEMENTATION_PHASES.md` | Phase 0～5のタスク順と受入条件 |
| `docs/SECURITY_TEST_MATRIX.md` | セキュリティ試験とGo/No-Go |
| `references/PRODUCT_SPEC_v1.0.md` | 元の名刺AI製品仕様書 |
| `references/UI_UX_SPEC_v1.1.md` | iPhone/Android/PC向けS00～S15の画面仕様 |
| `references/ARCHITECTURE_WINDOWS_v1.1.md` | OS別アーキテクチャとWindows実装検討 |
| `prototype/interactive-wireframe.html` | クリック式ワイヤーフレーム（架空データのみ） |
| `prototype/alternate-reference.html` | 別案の操作試作（架空データのみ） |

## Windowsで使う（PowerShell）

1. 本ZIPを新規開発用フォルダに展開する（実名刺・秘密鍵を入れない）。
2. Claude Code CLIを利用できる環境で、そのフォルダに移動し `claude` を実行。
3. 下記テキストをClaude Codeへ送信。

```text
このフォルダの CLAUDE.md と 01_CLAUDE_CODE_RUN_PROMPT.md を最後まで読み、
references/ の仕様書・prototype/ のUI見本も参照してください。
追加の企画案だけでは終わらず、指示書の Phase 0 から実装を開始してください。
実装・実行可能なテスト・結果記録まで進め、ユーザー側の操作が必須な事項だけ明確に報告してください。
実データを試験投入しないでください。
```

※iPhoneでのネイティブOCR・暗号化・撮影の実機確認にはDev Build、Apple開発者アカウント、署名と実機が必要になる場合があります。WindowsでもEAS BuildでiOSビルドを依頼できますが、自動で署名・配布できるとは限りません。

## 参考となる公式URL
- Claude Code指示の設計: https://claude.com/resources/articles/steering-claude-code-skills-hooks-rules-subagents-and-more
- Expo Router: https://docs.expo.dev/router/introduction/
- Expo SQLite / SQLCipher: https://docs.expo.dev/versions/latest/sdk/sqlite/
- Expo Crypto: https://docs.expo.dev/versions/latest/sdk/crypto/
- Expo EAS iOS開発ビルド: https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices/
- ML Kit iOS Japanese OCR: https://developers.google.com/ml-kit/vision/text-recognition/v2/ios
- OWASP MASVS: https://mas.owasp.org/MASVS/
