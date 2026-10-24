// Known-answer tests. Vectors are from public standards so any conforming implementation
// (WebCrypto in browsers, expo-crypto on iOS/Android) must reproduce them byte-for-byte.
import { gcm } from '@noble/ciphers/aes.js';
import { describe, expect, it } from 'vitest';
import { fromHex, toHex, utf8 } from '@/core/crypto/bytes';
import { buildAad, open, seal } from '@/core/crypto/envelope';
import { createNativeCryptoProvider, type ExpoCryptoLike } from '@/core/crypto/native-provider';
import { DecryptionError } from '@/core/crypto/provider';
import { createWebCryptoProvider } from '@/core/crypto/webcrypto';
import vectors from './fixtures/envelope-v1-vectors.json';

const web = createWebCryptoProvider();

/** expo-crypto stand-in backed by @noble/ciphers, an implementation independent of WebCrypto. */
function nobleExpoCrypto(): ExpoCryptoLike {
  type Sealed = { iv: Uint8Array; data: Uint8Array };
  return {
    getRandomBytes: (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
    AESEncryptionKey: { import: async (bytes) => ({ bytes: bytes.slice() }) },
    AESSealedData: { fromParts: (iv, data) => ({ iv, data }) satisfies Sealed },
    async aesEncryptAsync(plaintext, key, { nonce, additionalData }) {
      const out = gcm((key as unknown as { bytes: Uint8Array }).bytes, nonce.bytes, additionalData).encrypt(plaintext);
      return { ciphertext: async () => out };
    },
    async aesDecryptAsync(sealed, key, { additionalData }) {
      const s = sealed as unknown as Sealed;
      return gcm((key as unknown as { bytes: Uint8Array }).bytes, s.iv, additionalData).decrypt(s.data);
    },
  };
}
const native = createNativeCryptoProvider(nobleExpoCrypto());

describe.each([
  ['webcrypto', web],
  ['native adapter (noble stand-in for expo-crypto)', native],
])('%s known-answer tests', (_label, provider) => {
  it('AES-256-GCM: McGrew & Viega GCM spec test case 16 (with AAD)', async () => {
    const key = await provider.importAeadKey(fromHex('feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308'));
    const iv = fromHex('cafebabefacedbaddecaf888');
    const pt = fromHex('d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39');
    const aad = fromHex('feedfacedeadbeeffeedfacedeadbeefabaddad2');
    const out = await provider.encrypt(key, iv, pt, aad);
    expect(toHex(out), '既知ベクトルと暗号文が一致しない。直し方: AES-GCMの鍵長256bit・タグ長128bit・IVの渡し方を確認する').toBe(
      '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662' +
        '76fc6ece0f4e1768cddf8853bb2d551b',
    );
    expect(toHex(await provider.decrypt(key, iv, out, aad))).toBe(toHex(pt));
  });

  it('HKDF-SHA256: RFC 5869 test case 1', async () => {
    const okm = await provider.hkdfBytes(fromHex('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b'), fromHex('000102030405060708090a0b0c'), fromHex('f0f1f2f3f4f5f6f7f8f9'), 42);
    expect(toHex(okm), 'HKDF出力がRFC 5869と異なる。直し方: hash=SHA-256、salt/infoの順序を確認する').toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });

  it('SHA-256 of "abc" (FIPS 180-2)', async () => {
    expect(toHex(await provider.sha256(utf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it.each(vectors.cases)('envelope v1 vector "$name" decrypts to the expected plaintext', async (v) => {
    const base = await provider.importKdfKey(fromHex(vectors.vmkHex));
    const key = await provider.deriveAeadKey(base, utf8(v.vaultId), utf8(v.info));
    const ctx = { purpose: v.purpose as 'record', vaultId: v.vaultId, objectId: v.objectId, keyVersion: v.keyVersion };
    const plain = await open(provider, key, ctx, fromHex(v.envelopeHex));
    expect(new TextDecoder().decode(plain), '共通ベクトルを復号できない。直し方: AAD・ヘッダ・HKDF info が envelope.ts の仕様と一致するか確認する').toBe(v.plaintext);
    const again = await seal(provider, key, ctx, utf8(v.plaintext), fromHex(v.nonceHex));
    expect(toHex(again)).toBe(v.envelopeHex);
  });
});

describe('envelope tamper / misuse rejection (SEC-04)', () => {
  const ctx = { purpose: 'record' as const, vaultId: 'v_test', objectId: 'obj1', keyVersion: 1 };
  const setup = async () => {
    const key = await web.importAeadKey(new Uint8Array(32).fill(7));
    const env = await seal(web, key, ctx, utf8('架空 太郎'));
    return { key, env };
  };

  it('rejects a flipped ciphertext bit', async () => {
    const { key, env } = await setup();
    env[env.length - 20]! ^= 1;
    await expect(open(web, key, ctx, env)).rejects.toBeInstanceOf(DecryptionError);
  });
  it('rejects a different objectId (ciphertext swapping)', async () => {
    const { key, env } = await setup();
    await expect(open(web, key, { ...ctx, objectId: 'obj2' }, env)).rejects.toBeInstanceOf(DecryptionError);
  });
  it('rejects a different vaultId', async () => {
    const { key, env } = await setup();
    await expect(open(web, key, { ...ctx, vaultId: 'v_other' }, env)).rejects.toBeInstanceOf(DecryptionError);
  });
  it('rejects a key-version mismatch and a header rewrite', async () => {
    const { key, env } = await setup();
    await expect(open(web, key, { ...ctx, keyVersion: 2 }, env)).rejects.toBeInstanceOf(DecryptionError);
    const rewritten = env.slice();
    rewritten[5] = 2; // header says keyVersion 2, AAD was built for 1
    await expect(open(web, key, { ...ctx, keyVersion: 2 }, rewritten)).rejects.toBeInstanceOf(DecryptionError);
  });
  it('rejects a wrong key and a wrong purpose', async () => {
    const { env } = await setup();
    const other = await web.importAeadKey(new Uint8Array(32).fill(8));
    await expect(open(web, other, ctx, env)).rejects.toBeInstanceOf(DecryptionError);
    const { key } = await setup();
    await expect(open(web, key, { ...ctx, purpose: 'blob' }, env)).rejects.toBeInstanceOf(DecryptionError);
  });
  it('uses a fresh nonce for every seal', async () => {
    const { key } = await setup();
    const nonces = new Set<string>();
    for (let i = 0; i < 200; i++) nonces.add(toHex((await seal(web, key, ctx, utf8('x'))).subarray(6, 18)));
    expect(nonces.size, 'nonceが重複した。直し方: seal() が毎回 randomBytes(12) を使っているか確認する').toBe(200);
  });
  it('AAD contains vault, object and key version', () => {
    expect(new TextDecoder().decode(buildAad(ctx).subarray(6))).toBe('meishi-card/v1|record|v_test|obj1|1');
  });
});
