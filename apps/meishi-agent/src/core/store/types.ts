// Persistence contract shared by IndexedDB (web), SQLCipher (native) and the in-memory test store.
// Everything that can identify a person lives only inside `envelope` (AES-256-GCM ciphertext).
// The plaintext columns are opaque ids, revisions and flags.

export interface RemoteConflict {
  revision: number;
  deleted: boolean;
  envelope: Uint8Array | null;
  detectedAt: string;
}

export interface StoredRecord {
  id: string;
  envelope: Uint8Array | null; // null for a tombstone
  localOnly: boolean;
  deleted: boolean;
  dirty: boolean;
  serverRevision: number | null;
  /** Highest entity version ever accepted for this id (replay / rollback detection). */
  maxVersion: number;
  conflict?: RemoteConflict;
}

export interface StoredBlob {
  id: string;
  envelope: Uint8Array;
  uploaded: boolean;
  localOnly: boolean;
}

export interface EncryptedStore {
  readonly kind: 'memory' | 'indexeddb' | 'sqlcipher';
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  deleteMeta(key: string): Promise<void>;
  listRecords(): Promise<StoredRecord[]>;
  putRecords(records: StoredRecord[]): Promise<void>;
  deleteRecords(ids: string[]): Promise<void>;
  getBlob(id: string): Promise<StoredBlob | undefined>;
  putBlob(blob: StoredBlob): Promise<void>;
  deleteBlob(id: string): Promise<void>;
  listBlobs(): Promise<Array<Omit<StoredBlob, 'envelope'>>>;
  clearAll(): Promise<void>;
}

/** Keys used with get/setMeta. Values must never contain personal data. */
export const META = {
  vault: 'vault', // { recoveryEnvelope, createdAt }
  passcode: 'passcode', // PasscodeEnvelope (web)
  deviceKey: 'deviceKey', // non-extractable CryptoKey (web)
  unlockAttempts: 'unlockAttempts',
  sync: 'sync', // { cursor, deviceId, lastSyncAt, ... }
  settings: 'settings',
  audit: 'audit',
} as const;
