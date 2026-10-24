import type { EncryptedStore, StoredBlob, StoredRecord } from './types';

const clone = <T>(v: T): T => (v instanceof Uint8Array ? (v.slice() as T) : structuredClone(v));

export function createMemoryStore(): EncryptedStore & { dump(): { meta: Map<string, unknown>; records: Map<string, StoredRecord>; blobs: Map<string, StoredBlob> } } {
  const meta = new Map<string, unknown>();
  const records = new Map<string, StoredRecord>();
  const blobs = new Map<string, StoredBlob>();
  return {
    kind: 'memory',
    async getMeta<T>(key: string) {
      return meta.has(key) ? (clone(meta.get(key)) as T) : undefined;
    },
    async setMeta(key, value) {
      meta.set(key, clone(value));
    },
    async deleteMeta(key) {
      meta.delete(key);
    },
    async listRecords() {
      return [...records.values()].map(clone);
    },
    async putRecords(list) {
      for (const r of list) records.set(r.id, clone(r));
    },
    async deleteRecords(ids) {
      ids.forEach((id) => records.delete(id));
    },
    async getBlob(id) {
      const b = blobs.get(id);
      return b ? clone(b) : undefined;
    },
    async putBlob(b) {
      blobs.set(b.id, clone(b));
    },
    async deleteBlob(id) {
      blobs.delete(id);
    },
    async listBlobs() {
      return [...blobs.values()].map(({ envelope: _e, ...rest }) => rest);
    },
    async clearAll() {
      meta.clear();
      records.clear();
      blobs.clear();
    },
    dump: () => ({ meta, records, blobs }),
  };
}
