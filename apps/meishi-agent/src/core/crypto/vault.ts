// Vault Master Key (VMK) lifecycle. The VMK is 32 CSPRNG bytes; per-purpose AES keys are derived
// with HKDF-SHA256 and imported as non-extractable keys. Raw VMK bytes only exist transiently.
import { fromBase64, toBase64, toHex, utf8, wipe } from './bytes';
import { open, seal } from './envelope';
import { KEY_LENGTH, type AeadKey, type CryptoProvider } from './provider';
import { formatRecoveryKey, parseRecoveryKey } from './recovery-key';

export const CURRENT_KEY_VERSION = 1;
const INFO = {
  record: 'meishi-card/v1/record',
  blob: 'meishi-card/v1/blob',
  recoveryWrap: 'meishi-card/v1/recovery-wrap',
  passcodeWrap: 'meishi-card/v1/passcode-wrap',
} as const;

export interface VaultKeys {
  vaultId: string;
  keyVersion: number;
  recordKey: AeadKey;
  blobKey: AeadKey;
}

/** Stored on the device and (ciphertext only) on the sync server. Contains no secret in clear. */
export interface RecoveryEnvelope {
  format: 'meishi-recovery-envelope/v1';
  vaultId: string;
  keyVersion: number;
  envelope: string; // base64
}

export function newVaultId(provider: CryptoProvider): string {
  return `v_${toHex(provider.randomBytes(16))}`;
}

export async function deriveVaultKeys(provider: CryptoProvider, vmk: Uint8Array, vaultId: string, keyVersion = CURRENT_KEY_VERSION): Promise<VaultKeys> {
  if (vmk.length !== KEY_LENGTH) throw new Error('VMK must be 32 bytes');
  const base = await provider.importKdfKey(vmk);
  const salt = utf8(vaultId);
  return {
    vaultId,
    keyVersion,
    recordKey: await provider.deriveAeadKey(base, salt, utf8(`${INFO.record}/k${keyVersion}`)),
    blobKey: await provider.deriveAeadKey(base, salt, utf8(`${INFO.blob}/k${keyVersion}`)),
  };
}

async function recoveryWrapKey(provider: CryptoProvider, recoveryRaw: Uint8Array, vaultId: string): Promise<AeadKey> {
  const base = await provider.importKdfKey(recoveryRaw);
  return provider.deriveAeadKey(base, utf8(vaultId), utf8(INFO.recoveryWrap));
}

const vmkContext = (vaultId: string, keyVersion: number) => ({ purpose: 'recovery-wrap' as const, vaultId, objectId: 'vmk', keyVersion });

export interface CreatedVault {
  keys: VaultKeys;
  recoveryKey: string;
  recoveryEnvelope: RecoveryEnvelope;
}

/**
 * Creates a vault. `onVmk` receives the raw VMK once (e.g. to create a device passcode wrap or to
 * store it in the iOS Keychain) and must not retain it; the buffer is wiped afterwards.
 */
export async function createVault(provider: CryptoProvider, onVmk?: (vmk: Uint8Array, vaultId: string) => Promise<void>): Promise<CreatedVault> {
  const vaultId = newVaultId(provider);
  const vmk = provider.randomBytes(KEY_LENGTH);
  const recoveryRaw = provider.randomBytes(KEY_LENGTH);
  try {
    const wrapKey = await recoveryWrapKey(provider, recoveryRaw, vaultId);
    const envelope = await seal(provider, wrapKey, vmkContext(vaultId, CURRENT_KEY_VERSION), vmk);
    const keys = await deriveVaultKeys(provider, vmk, vaultId);
    if (onVmk) await onVmk(vmk, vaultId);
    return {
      keys,
      recoveryKey: await formatRecoveryKey(recoveryRaw, provider.sha256),
      recoveryEnvelope: { format: 'meishi-recovery-envelope/v1', vaultId, keyVersion: CURRENT_KEY_VERSION, envelope: toBase64(envelope) },
    };
  } finally {
    wipe(vmk);
    wipe(recoveryRaw);
  }
}

/** Throws RecoveryKeyFormatError for typos and DecryptionError for a wrong key. */
export async function unlockWithRecoveryKey(
  provider: CryptoProvider,
  envelope: RecoveryEnvelope,
  recoveryKey: string,
  onVmk?: (vmk: Uint8Array, vaultId: string) => Promise<void>,
): Promise<VaultKeys> {
  const recoveryRaw = await parseRecoveryKey(recoveryKey, provider.sha256);
  let vmk: Uint8Array | undefined;
  try {
    const wrapKey = await recoveryWrapKey(provider, recoveryRaw, envelope.vaultId);
    vmk = await open(provider, wrapKey, vmkContext(envelope.vaultId, envelope.keyVersion), fromBase64(envelope.envelope));
    const keys = await deriveVaultKeys(provider, vmk, envelope.vaultId, envelope.keyVersion);
    if (onVmk) await onVmk(vmk, envelope.vaultId);
    return keys;
  } finally {
    wipe(recoveryRaw);
    wipe(vmk);
  }
}

// ---- Optional per-device passcode (web). Two layers: PBKDF2(passcode) and a non-extractable
// device key that never leaves this browser profile. Both are required to unwrap.

export interface PasscodeEnvelope {
  format: 'meishi-passcode-envelope/v1';
  vaultId: string;
  keyVersion: number;
  salt: string;
  iterations: number;
  envelope: string;
}

export const PASSCODE_ITERATIONS = 600_000; // OWASP Password Storage Cheat Sheet, PBKDF2-HMAC-SHA256

export type Pbkdf2 = (password: string, salt: Uint8Array, iterations: number) => Promise<Uint8Array>;

async function passcodeKey(provider: CryptoProvider, pbkdf2: Pbkdf2, passcode: string, salt: Uint8Array, iterations: number, vaultId: string) {
  const stretched = await pbkdf2(passcode, salt, iterations);
  try {
    const base = await provider.importKdfKey(stretched);
    return provider.deriveAeadKey(base, utf8(vaultId), utf8(INFO.passcodeWrap));
  } finally {
    wipe(stretched);
  }
}

export async function wrapWithPasscode(
  provider: CryptoProvider,
  pbkdf2: Pbkdf2,
  deviceKey: AeadKey,
  vmk: Uint8Array,
  vaultId: string,
  passcode: string,
  iterations = PASSCODE_ITERATIONS,
): Promise<PasscodeEnvelope> {
  const salt = provider.randomBytes(16);
  const inner = await seal(provider, await passcodeKey(provider, pbkdf2, passcode, salt, iterations, vaultId), { purpose: 'passcode-wrap', vaultId, objectId: 'vmk', keyVersion: CURRENT_KEY_VERSION }, vmk);
  const outer = await seal(provider, deviceKey, { purpose: 'device-wrap', vaultId, objectId: 'vmk', keyVersion: CURRENT_KEY_VERSION }, inner);
  return { format: 'meishi-passcode-envelope/v1', vaultId, keyVersion: CURRENT_KEY_VERSION, salt: toBase64(salt), iterations, envelope: toBase64(outer) };
}

export async function unlockWithPasscode(provider: CryptoProvider, pbkdf2: Pbkdf2, deviceKey: AeadKey, env: PasscodeEnvelope, passcode: string): Promise<VaultKeys> {
  const inner = await open(provider, deviceKey, { purpose: 'device-wrap', vaultId: env.vaultId, objectId: 'vmk', keyVersion: env.keyVersion }, fromBase64(env.envelope));
  const key = await passcodeKey(provider, pbkdf2, passcode, fromBase64(env.salt), env.iterations, env.vaultId);
  let vmk: Uint8Array | undefined;
  try {
    vmk = await open(provider, key, { purpose: 'passcode-wrap', vaultId: env.vaultId, objectId: 'vmk', keyVersion: env.keyVersion }, inner);
    return await deriveVaultKeys(provider, vmk, env.vaultId, env.keyVersion);
  } finally {
    wipe(vmk);
  }
}
