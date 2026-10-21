# ADR-006 OCR：Webは端末内Tesseract（日本語）、ネイティブはML Kit統合待ち

- 日付: 2026-10-21 / 状態: 採用（Web）／保留（ネイティブ）

## Web
- Tesseract.js 7.0.0（WASM, LSTM）＋ `@tesseract.js-data/jpn`（tessdata best_int, 約2MB）。ワーカー・コア・言語データは `scripts/copy-vendor.mjs` で `public/ocr/` にコピーし**同一オリジンから配信**（CDN既定値を上書き、`cacheMethod: none`）。CSPは `script-src 'self' 'wasm-unsafe-eval'`。
- 画像は端末内で縮小・JPEG再エンコード（EXIF/位置情報除去）してから暗号化保存→OCR。
- 実測（E2E、IPAGothicで描画した架空名刺、Chromium）: 7項目中5項目が完全一致（会社・部署・役職・メール・代表電話）。氏名（架→洒）と携帯番号（0→9の誤認）は誤り → 確認画面で人が修正する設計。氏名の信頼度は5%と表示され「未確認」になる。
- `jpn+eng` の併用は tesseract.js 7.0.0 で初期化に失敗した（`Failed loading language ''`）ため不採用。メールの「. 」等の空白混入は `tidyLine()` で補正。
- 縦書きは jpn_vert モデル未同梱のため精度が低い（制約として画面に表示）。

## ネイティブ（iOS/Android）
- 指示書は Google ML Kit Text Recognition v2 日本語モデル。Google公式に日本語対応と専用Pod（`GoogleMLKit/TextRecognitionJapanese`）がある（https://developers.google.com/ml-kit/vision/text-recognition/v2/ios 公式、2026-10-21検索結果より）。
- Expo公式のConfig Pluginは見つからなかった。コミュニティ製 `expo-mlkit-ocr`（2026年5月作成、日本語オプションの有無は未確認）、`@zhanziyang/expo-text-extractor`（iOSはApple Vision）等がある（いずれも非公式）。
- **開発ビルドと実機がないと検証できないため未統合**。現在のネイティブ版は「手入力」OCRアダプタ（`manualOcr`）にフォールバックし、画面にその旨を表示する。統合手順は USER_ACTIONS / PROGRESS に記載。
