import { DecryptionError, KEY_LENGTH, NONCE_LENGTH, type AeadKey, type CryptoProvider, type KdfKey } from './provider';

interface WebAeadKey extends AeadKey {
  readonly key: CryptoKey;
}
interface WebKdfKey extends KdfKey {
  readonly key: CryptoKey;
}

// TS 5.7+ distinguishes ArrayBuffer-backed views; WebCrypto accepts any BufferSource at runtime.
const buf = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

/**
 * WebCrypto (browser SubtleCrypto / Node webcrypto). Keys are imported as non-extractable so
 * page scripts cannot export the raw bytes, which narrows (not eliminates) XSS impact.
 */
export function createWebCryptoProvider(subtle: SubtleCrypto = globalThis.crypto.subtle, rng: Crypto = globalThis.crypto): CryptoProvider {
  if (!subtle) throw new Error('WebCrypto (crypto.subtle) is unavailable. HTTPS (secure context) is required.');
  return {
    name: 'webcrypto',
    randomBytes(length) {
      const out = new Uint8Array(length);
      rng.getRandomValues(out);
      return out;
    },
    async importKdfKey(raw) {
      if (raw.length !== KEY_LENGTH) throw new Error('KDF key must be 32 bytes');
      const key = await subtle.importKey('raw', buf(raw), 'HKDF', false, ['deriveKey', 'deriveBits']);
      return { kind: 'kdf', key } as WebKdfKey;
    },
    async deriveAeadKey(base, salt, info) {
      const key = await subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) },
        (base as WebKdfKey).key,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
      return { kind: 'aead', key } as WebAeadKey;
    },
    async hkdfBytes(ikm, salt, info, length) {
      const base = await subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
      const bits = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) }, base, length * 8);
      return new Uint8Array(bits);
    },
    async importAeadKey(raw) {
      if (raw.length !== KEY_LENGTH) throw new Error('AES key must be 32 bytes');
      const key = await subtle.importKey('raw', buf(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      return { kind: 'aead', key } as WebAeadKey;
    },
    async encrypt(key, nonce, plaintext, aad) {
      if (nonce.length !== NONCE_LENGTH) throw new Error('nonce must be 12 bytes');
      const out = await subtle.encrypt(
        { name: 'AES-GCM', iv: buf(nonce), additionalData: buf(aad), tagLength: 128 },
        (key as WebAeadKey).key,
        buf(plaintext),
      );
      return new Uint8Array(out);
    },
    async decrypt(key, nonce, sealed, aad) {
      try {
        const out = await subtle.decrypt(
          { name: 'AES-GCM', iv: buf(nonce), additionalData: buf(aad), tagLength: 128 },
          (key as WebAeadKey).key,
          buf(sealed),
        );
        return new Uint8Array(out);
      } catch {
        throw new DecryptionError();
      }
    },
    async sha256(data) {
      return new Uint8Array(await subtle.digest('SHA-256', buf(data)));
    },
  };
}

/** Adopts an existing non-extractable CryptoKey (e.g. a device key persisted in IndexedDB). */
export function adoptWebAeadKey(key: CryptoKey): AeadKey {
  return { kind: 'aead', key } as WebAeadKey;
}

/** PBKDF2-HMAC-SHA256, used only for the optional per-device passcode on the web. */
export async function pbkdf2Sha256(password: string, salt: Uint8Array, iterations: number, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<Uint8Array> {
  const base = await subtle.importKey('raw', buf(new TextEncoder().encode(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations }, base, 256);
  return new Uint8Array(bits);
}
