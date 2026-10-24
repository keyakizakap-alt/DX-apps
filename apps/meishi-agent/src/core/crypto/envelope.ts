// Envelope format v1 (docs/ADR/002-crypto-format.md):
//   [0]      format version (0x01)
//   [1]      key purpose id
//   [2..5]   key version, uint32 big-endian
//   [6..17]  96-bit random nonce
//   [18..]   AES-256-GCM ciphertext || 128-bit tag
// AAD = header[0..5] || utf8("meishi-card/v1|<purpose>|<vaultId>|<objectId>|<keyVersion>")
// Binding objectId and vaultId in the AAD stops a server from swapping ciphertexts between objects.
import { concatBytes, utf8 } from './bytes';
import { DecryptionError, NONCE_LENGTH, TAG_LENGTH, type AeadKey, type CryptoProvider } from './provider';

export const FORMAT_VERSION = 1;
export const HEADER_LENGTH = 6;

export const KEY_PURPOSES = {
  record: 1,
  blob: 2,
  'recovery-wrap': 3,
  'device-wrap': 4,
  'passcode-wrap': 5,
} as const;
export type KeyPurpose = keyof typeof KEY_PURPOSES;

export interface EnvelopeContext {
  purpose: KeyPurpose;
  vaultId: string;
  objectId: string;
  keyVersion: number;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function header(ctx: EnvelopeContext): Uint8Array {
  if (!Number.isInteger(ctx.keyVersion) || ctx.keyVersion < 1 || ctx.keyVersion > 0xffffffff) throw new Error('invalid key version');
  if (!ID_PATTERN.test(ctx.vaultId) || !ID_PATTERN.test(ctx.objectId)) throw new Error('invalid vault/object id');
  const h = new Uint8Array(HEADER_LENGTH);
  h[0] = FORMAT_VERSION;
  h[1] = KEY_PURPOSES[ctx.purpose];
  new DataView(h.buffer).setUint32(2, ctx.keyVersion, false);
  return h;
}

export function buildAad(ctx: EnvelopeContext): Uint8Array {
  return concatBytes(header(ctx), utf8(`meishi-card/v1|${ctx.purpose}|${ctx.vaultId}|${ctx.objectId}|${ctx.keyVersion}`));
}

export interface EnvelopeHeader {
  version: number;
  purposeId: number;
  keyVersion: number;
}

export function readHeader(envelope: Uint8Array): EnvelopeHeader {
  if (envelope.length < HEADER_LENGTH + NONCE_LENGTH + TAG_LENGTH) throw new DecryptionError('暗号文が短すぎます');
  return {
    version: envelope[0]!,
    purposeId: envelope[1]!,
    keyVersion: new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength).getUint32(2, false),
  };
}

/**
 * Encrypts with a fresh random nonce. `nonceForTest` exists only so known-answer vectors can be
 * reproduced; production callers never pass it (enforced by tests/security/no-fixed-nonce.test.ts).
 */
export async function seal(
  provider: CryptoProvider,
  key: AeadKey,
  ctx: EnvelopeContext,
  plaintext: Uint8Array,
  nonceForTest?: Uint8Array,
): Promise<Uint8Array> {
  const nonce = nonceForTest ?? provider.randomBytes(NONCE_LENGTH);
  const sealed = await provider.encrypt(key, nonce, plaintext, buildAad(ctx));
  return concatBytes(header(ctx), nonce, sealed);
}

export async function open(provider: CryptoProvider, key: AeadKey, ctx: EnvelopeContext, envelope: Uint8Array): Promise<Uint8Array> {
  const h = readHeader(envelope);
  if (h.version !== FORMAT_VERSION) throw new DecryptionError('未対応の暗号形式です');
  if (h.purposeId !== KEY_PURPOSES[ctx.purpose]) throw new DecryptionError('鍵の用途が一致しません');
  if (h.keyVersion !== ctx.keyVersion) throw new DecryptionError('鍵バージョンが一致しません');
  const nonce = envelope.subarray(HEADER_LENGTH, HEADER_LENGTH + NONCE_LENGTH);
  const sealed = envelope.subarray(HEADER_LENGTH + NONCE_LENGTH);
  return provider.decrypt(key, nonce, sealed, buildAad(ctx));
}
