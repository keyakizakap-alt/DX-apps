# ADR-001 技術スタック：Expo SDK 58 単一アプリ（Web先行で検証）

- 日付: 2026-10-21 / 状態: 採用

## 決定
- **Expo SDK 58 + Expo Router + React Native Web + TypeScript strict** の単一アプリ（指示書の推奨どおり）。`expo` 58.0.16 / `react-native` 0.88.0 / `react` 19.3.0（`create-expo-app` と `npx expo install` が解決したSDK互換版）。
- ドメイン・暗号・同期・AIポリシーは `src/core/` に **React/RN非依存のTS** として実装し、Node（Vitest）で検証する。OS別実装は `src/platform/*.web.ts | *.native.ts` に分離。
- 本環境で実際に起動・検証できるのは **Webビルド（iPhone Safari / Android Chrome / PCブラウザでも同じものが動く）**。ネイティブ（iOS/Android）コードは型検査済みだが **ビルド・実機未検証**。

## 根拠（公式ドキュメント、2026-10-21取得）
- `expo-sqlite` は SQLCipher を Android/iOS/macOS でサポート、`useSQLCipher` + 開発ビルドが必要、Webでは使えない。SQLCipher未リンク時 `PRAGMA key` は**黙って無視**されるため `PRAGMA cipher_version` で確認が必要 — https://docs.expo.dev/versions/latest/sdk/sqlite/ （公式）
- `expo-crypto` は AES-GCM（`aesEncryptAsync`/`aesDecryptAsync`、AAD対応、Appleはタグ16byte固定）を Android/iOS/Web で提供 — https://docs.expo.dev/versions/latest/sdk/crypto/ （公式）
- Expo Router の導入（`main: expo-router/entry`、`src/app`）— https://docs.expo.dev/router/installation/ （公式）

## 代替案
| 案 | 長所 | 短所 | 判断 |
|---|---|---|---|
| Expo単一アプリ（採用） | 指示書推奨、iOS/Android/Webのコード共有、EASでWindowsからiOSビルド可 | ネイティブ検証にMac不要だがApple署名・実機が必要 | 採用 |
| PWA専用（React+Vite） | 依存が軽い、全端末で即起動 | iOSでSQLCipher/Keychain/ML Kitが使えない | 不採用（ただしExpoのWeb出力がPWA相当を兼ねる） |
| ネイティブ個別実装 | 性能最大 | 3実装の保守 | 不採用 |

## 影響
- Webは async routes を無効化（`app.json`）し、Service Worker（`public/sw.js`）でアプリ本体をキャッシュしてオフライン遷移を可能にした（E2Eでオフライン遷移失敗を検出したため）。
- サーバーは Node 22.18+/24 の型ストリップで直接実行する。`erasableSyntaxOnly` を有効化し、型ストリップ不可の構文を型検査で検出する。
