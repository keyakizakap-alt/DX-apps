// Recovery key = 256 random bits + 16-bit SHA-256 checksum, Crockford Base32, grouped by 5.
// It is high-entropy, so it is fed to HKDF directly (no password KDF is needed or used).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_KEY_BYTES = 32;
export const RECOVERY_KEY_PREFIX = 'MK1';

function encode32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function decode32(text: string, byteLength: number): Uint8Array {
  const out = new Uint8Array(byteLength);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const ch of text) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new RecoveryKeyFormatError();
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      if (index < byteLength) out[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  // Reject non-canonical encodings (non-zero padding bits) so each key has exactly one spelling.
  if (index !== byteLength || value !== 0) throw new RecoveryKeyFormatError();
  return out;
}

export class RecoveryKeyFormatError extends Error {
  constructor() {
    super('復旧キーの形式が正しくありません。文字数と区切りを確認してください。');
    this.name = 'RecoveryKeyFormatError';
  }
}

export async function formatRecoveryKey(raw: Uint8Array, sha256: (d: Uint8Array) => Promise<Uint8Array>): Promise<string> {
  if (raw.length !== RECOVERY_KEY_BYTES) throw new Error('recovery key must be 32 bytes');
  const sum = (await sha256(raw)).subarray(0, 2);
  const body = encode32(new Uint8Array([...raw, ...sum]));
  const groups = body.match(/.{1,5}/g) ?? [];
  return [RECOVERY_KEY_PREFIX, ...groups].join('-');
}

export function normalizeRecoveryKeyInput(input: string): string {
  return input
    .toUpperCase()
    .replace(/^\s*MK1/, '')
    .replace(/[\s\-‐－ー]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

export async function parseRecoveryKey(input: string, sha256: (d: Uint8Array) => Promise<Uint8Array>): Promise<Uint8Array> {
  const body = normalizeRecoveryKeyInput(input);
  if (body.length !== 55) throw new RecoveryKeyFormatError();
  const bytes = decode32(body, RECOVERY_KEY_BYTES + 2);
  const raw = bytes.slice(0, RECOVERY_KEY_BYTES);
  const sum = (await sha256(raw)).subarray(0, 2);
  if (sum[0] !== bytes[32] || sum[1] !== bytes[33]) throw new RecoveryKeyFormatError();
  return raw;
}

/** Groups (1-based, excluding the prefix) the user must re-type to prove the key was stored. */
export function pickConfirmationGroups(randomBytes: (n: number) => Uint8Array, groupCount = 11): [number, number] {
  const r = randomBytes(2);
  const a = (r[0]! % groupCount) + 1;
  let b = (r[1]! % groupCount) + 1;
  if (b === a) b = (a % groupCount) + 1;
  return a < b ? [a, b] : [b, a];
}

export function recoveryKeyGroup(formatted: string, index: number): string {
  return formatted.split('-')[index] ?? '';
}
