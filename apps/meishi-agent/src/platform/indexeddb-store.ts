// Web persistence: IndexedDB holding ciphertext envelopes only (see store/types.ts).
// The device key stored under META.deviceKey is a non-extractable CryptoKey object.
import type { EncryptedStore, StoredBlob, StoredRecord } from '../core/store/types';

const DB_NAME = 'meishi-agent';
const DB_VERSION = 1;

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export async function openIndexedDbStore(factory: IDBFactory = globalThis.indexedDB, name = DB_NAME): Promise<EncryptedStore> {
  if (!factory) throw new Error('IndexedDB is unavailable in this browser');
  const open = factory.open(name, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    // Migration v1
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
  };
  const db = await promisify(open);
  const store = (name: 'meta' | 'records' | 'blobs', mode: IDBTransactionMode = 'readonly') => db.transaction(name, mode).objectStore(name);

  return {
    kind: 'indexeddb',
    async getMeta<T>(key: string) {
      return (await promisify(store('meta').get(key))) as T | undefined;
    },
    async setMeta(key, value) {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(value, key);
      await done(tx);
    },
    async deleteMeta(key) {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').delete(key);
      await done(tx);
    },
    async listRecords() {
      return (await promisify(store('records').getAll())) as StoredRecord[];
    },
    async putRecords(records) {
      if (records.length === 0) return;
      const tx = db.transaction('records', 'readwrite');
      const os = tx.objectStore('records');
      for (const r of records) os.put(r);
      await done(tx); // atomic: all or nothing
    },
    async deleteRecords(ids) {
      if (ids.length === 0) return;
      const tx = db.transaction('records', 'readwrite');
      ids.forEach((id) => tx.objectStore('records').delete(id));
      await done(tx);
    },
    async getBlob(id) {
      return (await promisify(store('blobs').get(id))) as StoredBlob | undefined;
    },
    async putBlob(blob) {
      const tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').put(blob);
      await done(tx);
    },
    async deleteBlob(id) {
      const tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').delete(id);
      await done(tx);
    },
    async listBlobs() {
      const all = (await promisify(store('blobs').getAll())) as StoredBlob[];
      return all.map(({ envelope: _e, ...rest }) => rest);
    },
    async clearAll() {
      const tx = db.transaction(['meta', 'records', 'blobs'], 'readwrite');
      for (const n of ['meta', 'records', 'blobs'] as const) tx.objectStore(n).clear();
      await done(tx);
    },
  };
}
