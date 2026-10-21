// The only surface through which the app performs cryptography. Implementations wrap
// audited primitives (WebCrypto, expo-crypto, @noble/hashes); nothing here is home-grown.

/** Opaque AES-256-GCM key. On the web this is a non-extractable CryptoKey. */
export interface AeadKey {
  readonly kind: 'aead';
}

/** Opaque HKDF input key (the Vault Master Key or a recovery key). */
export interface KdfKey {
  readonly kind: 'kdf';
}

export interface CryptoProvider {
  readonly name: string;
  randomBytes(length: number): Uint8Array;
  /** Imports 32 raw bytes as an HKDF-SHA256 base key. Caller wipes `raw` afterwards. */
  importKdfKey(raw: Uint8Array): Promise<KdfKey>;
  /** HKDF-SHA256 → AES-256-GCM key (RFC 5869). */
  deriveAeadKey(base: KdfKey, salt: Uint8Array, info: Uint8Array): Promise<AeadKey>;
  /** Raw HKDF-SHA256 output, used only for known-answer tests and key-check values. */
  hkdfBytes(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array>;
  /** AES-256-GCM. Returns ciphertext || 16 byte tag. */
  encrypt(key: AeadKey, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
  /** Throws on authentication failure. */
  decrypt(key: AeadKey, nonce: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
  /** Imports raw bytes as AES-256-GCM key (tests / native key store only). */
  importAeadKey(raw: Uint8Array): Promise<AeadKey>;
  sha256(data: Uint8Array): Promise<Uint8Array>;
}

export class DecryptionError extends Error {
  constructor(message = '復号できませんでした（鍵違い・改ざん・形式違い）') {
    super(message);
    this.name = 'DecryptionError';
  }
}

export const NONCE_LENGTH = 12;
export const TAG_LENGTH = 16;
export const KEY_LENGTH = 32;
