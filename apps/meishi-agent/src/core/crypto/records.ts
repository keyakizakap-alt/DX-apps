// Record-level helpers: JSON payloads are sealed with the record key, image blobs with the blob key.
import { fromUtf8, utf8 } from './bytes';
import { open, seal } from './envelope';
import type { CryptoProvider } from './provider';
import type { VaultKeys } from './vault';

export async function sealRecord(provider: CryptoProvider, keys: VaultKeys, objectId: string, value: unknown): Promise<Uint8Array> {
  return seal(provider, keys.recordKey, { purpose: 'record', vaultId: keys.vaultId, objectId, keyVersion: keys.keyVersion }, utf8(JSON.stringify(value)));
}

export async function openRecord(provider: CryptoProvider, keys: VaultKeys, objectId: string, envelope: Uint8Array): Promise<unknown> {
  const plain = await open(provider, keys.recordKey, { purpose: 'record', vaultId: keys.vaultId, objectId, keyVersion: keys.keyVersion }, envelope);
  return JSON.parse(fromUtf8(plain));
}

export async function sealBlob(provider: CryptoProvider, keys: VaultKeys, blobId: string, bytes: Uint8Array): Promise<Uint8Array> {
  return seal(provider, keys.blobKey, { purpose: 'blob', vaultId: keys.vaultId, objectId: blobId, keyVersion: keys.keyVersion }, bytes);
}

export async function openBlob(provider: CryptoProvider, keys: VaultKeys, blobId: string, envelope: Uint8Array): Promise<Uint8Array> {
  return open(provider, keys.blobKey, { purpose: 'blob', vaultId: keys.vaultId, objectId: blobId, keyVersion: keys.keyVersion }, envelope);
}
