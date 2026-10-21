// CryptoProvider for iOS/Android: AES-256-GCM from expo-crypto (Apple CryptoKit / Android JCA),
// HKDF-SHA256 from @noble/hashes (audited, RFC 5869). The expo-crypto module is injected so that
// the adapter logic is unit-testable in Node; on device it is `import * as ExpoCrypto from 'expo-crypto'`.
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { DecryptionError, KEY_LENGTH, NONCE_LENGTH, TAG_LENGTH, type AeadKey, type CryptoProvider, type KdfKey } from './provider';

export interface ExpoCryptoLike {
  getRandomBytes(byteCount: number): Uint8Array;
  AESEncryptionKey: { import(bytes: Uint8Array): Promise<unknown> };
  AESSealedData: { fromParts(iv: Uint8Array, ciphertextWithTag: Uint8Array, tagLength?: number): unknown };
  aesEncryptAsync(plaintext: Uint8Array, key: never, options: { nonce: { bytes: Uint8Array }; additionalData: Uint8Array }): Promise<{ ciphertext(options: { encoding: 'bytes'; includeTag: boolean }): Promise<string | Uint8Array> }>;
  aesDecryptAsync(sealed: never, key: never, options: { additionalData: Uint8Array; output: 'bytes' }): Promise<string | Uint8Array>;
}

interface NativeAeadKey extends AeadKey {
  readonly handle: unknown;
}
interface NativeKdfKey extends KdfKey {
  readonly ikm: Uint8Array;
}

export function createNativeCryptoProvider(expo: ExpoCryptoLike): CryptoProvider {
  const importAead = async (raw: Uint8Array): Promise<AeadKey> => {
    if (raw.length !== KEY_LENGTH) throw new Error('AES key must be 32 bytes');
    return { kind: 'aead', handle: await expo.AESEncryptionKey.import(raw) } as NativeAeadKey;
  };
  return {
    name: 'expo-crypto+noble-hkdf',
    randomBytes(length) {
      // expo-crypto caps a single call at 1024 bytes.
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i += 1024) out.set(expo.getRandomBytes(Math.min(1024, length - i)), i);
      return out;
    },
    async importKdfKey(raw) {
      if (raw.length !== KEY_LENGTH) throw new Error('KDF key must be 32 bytes');
      return { kind: 'kdf', ikm: raw.slice() } as NativeKdfKey;
    },
    async deriveAeadKey(base, salt, info) {
      const okm = hkdf(sha256, (base as NativeKdfKey).ikm, salt, info, KEY_LENGTH);
      try {
        return await importAead(okm);
      } finally {
        okm.fill(0);
      }
    },
    async hkdfBytes(ikm, salt, info, length) {
      return hkdf(sha256, ikm, salt, info, length);
    },
    importAeadKey: importAead,
    async encrypt(key, nonce, plaintext, aad) {
      if (nonce.length !== NONCE_LENGTH) throw new Error('nonce must be 12 bytes');
      const sealed = await expo.aesEncryptAsync(plaintext, (key as NativeAeadKey).handle as never, { nonce: { bytes: nonce }, additionalData: aad });
      const out = await sealed.ciphertext({ encoding: 'bytes', includeTag: true });
      if (typeof out === 'string') throw new Error('unexpected encoding');
      return out;
    },
    async decrypt(key, nonce, sealed, aad) {
      try {
        const data = expo.AESSealedData.fromParts(nonce, sealed, TAG_LENGTH);
        const out = await expo.aesDecryptAsync(data as never, (key as NativeAeadKey).handle as never, { additionalData: aad, output: 'bytes' });
        if (typeof out === 'string') throw new Error('unexpected encoding');
        return out;
      } catch {
        throw new DecryptionError();
      }
    },
    async sha256(data) {
      return sha256(data);
    },
  };
}
