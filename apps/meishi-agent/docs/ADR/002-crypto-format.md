# ADR-002 暗号形式 v1（エンベロープ）

- 日付: 2026-10-21 / 状態: 採用

## 形式
```
[0]      形式バージョン 0x01
[1]      鍵用途ID（1=record, 2=blob, 3=recovery-wrap, 4=device-wrap, 5=passcode-wrap）
[2..5]   鍵バージョン uint32 BE
[6..17]  96bit 乱数nonce（CSPRNG、毎回新規）
[18..]   AES-256-GCM 暗号文 || 128bit タグ
AAD = header[0..5] || "meishi-card/v1|<用途>|<vaultId>|<objectId>|<鍵バージョン>"
```
- 鍵導出: VMK（32byte CSPRNG）から **HKDF-SHA256**（salt=vaultId, info=`meishi-card/v1/record/k1` 等）で用途別鍵を導出。独自KDF・独自暗号は使わない。
- AADに vaultId・objectId・用途・鍵バージョンを含めるため、サーバーが暗号文を別オブジェクトへ差し替える・用途を偽る・鍵バージョンを書き換えると復号に失敗する。
- 平文側に単調増加の `version` を持ち、同期時に既知より古い版は**巻き戻し（リプレイ）として拒否**する（AESの外側でのリプレイ対策）。

## 実装と検証
| 実装 | 用途 | 検証 |
|---|---|---|
| WebCrypto（`src/core/crypto/webcrypto.ts`） | ブラウザ・Node | 既知ベクトル: McGrew–Viega GCM test case 16、RFC 5869 HKDF case 1、SHA-256 "abc" |
| expo-crypto + @noble/hashes HKDF（`native-provider.ts`） | iOS/Android | 同ベクトルを、expo-crypto を **@noble/ciphers で代替**したアダプタで検証（アダプタの配線を検証。**実機の expo-crypto は未検証**） |
| 共通ベクトル `tests/unit/fixtures/envelope-v1-vectors.json` | 相互運用 | WebCryptoと独立実装（@noble）で生成した暗号文が**バイト単位で一致** |

- 改ざん・鍵違い・objectId/vaultId違い・鍵バージョン不一致・ヘッダ書換え・用途違いで復号失敗すること、nonce 200回で重複なしを試験（`tests/unit/crypto-vectors.test.ts`）。

## 限界
- 12byte乱数nonceの衝突確率は 2^32 回暗号化で約2^-33。1保管庫の想定件数（数万〜数十万レコード更新）では十分小さい。鍵ローテーション（keyVersion 2以降）は形式上サポートしているが、**再暗号化処理は未実装**。
- iOS実機の expo-crypto（CryptoKit）での相互復号は **NOT_TESTED**（SEC-05）。手順は PROGRESS の実機チェックリスト参照。
