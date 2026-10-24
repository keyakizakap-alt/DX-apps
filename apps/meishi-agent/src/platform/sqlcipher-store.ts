// iOS/Android persistence: expo-sqlite compiled with SQLCipher (app.json: useSQLCipher=true).
// The 256-bit database key lives in the OS key store (iOS Keychain / Android Keystore-backed
// SecureStore), is applied with PRAGMA key immediately after opening, and the store refuses to
// run if SQLCipher is not actually linked (PRAGMA cipher_version returns nothing).
// Records inside are additionally AES-GCM envelopes, so SQLCipher is defence in depth.
// STATUS: written against the SDK 58 type declarations; NOT executed on a device (see PROGRESS).
import * as SQLite from 'expo-sqlite';
import type { EncryptedStore, StoredBlob, StoredRecord } from '../core/store/types';
import { fromBase64, toBase64 } from '../core/crypto/bytes';

export class SqlCipherUnavailableError extends Error {
  constructor() {
    super('SQLCipher がこのビルドに含まれていません。開発ビルド（useSQLCipher）で実行してください。');
  }
}

export async function openSqlCipherStore(hexKey: string, name = 'meishi-agent.db'): Promise<EncryptedStore> {
  if (!/^[0-9a-f]{64}$/.test(hexKey)) throw new Error('invalid database key');
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync(`PRAGMA key = "x'${hexKey}'";`);
  const cipher = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version;');
  if (!cipher?.cipher_version) {
    await db.closeAsync();
    throw new SqlCipherUnavailableError(); // fail closed: never write cards into a plaintext DB
  }
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, uploaded INTEGER NOT NULL, local_only INTEGER NOT NULL, envelope BLOB NOT NULL);
  `);
  const encodeRecord = (r: StoredRecord) =>
    JSON.stringify({ ...r, envelope: r.envelope ? toBase64(r.envelope) : null, conflict: r.conflict ? { ...r.conflict, envelope: r.conflict.envelope ? toBase64(r.conflict.envelope) : null } : undefined });
  const decodeRecord = (json: string): StoredRecord => {
    const r = JSON.parse(json);
    return { ...r, envelope: r.envelope ? fromBase64(r.envelope) : null, conflict: r.conflict ? { ...r.conflict, envelope: r.conflict.envelope ? fromBase64(r.conflict.envelope) : null } : undefined };
  };
  return {
    kind: 'sqlcipher',
    async getMeta<T>(key: string) {
      const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
      return row ? (JSON.parse(row.value) as T) : undefined;
    },
    async setMeta(key, value) {
      await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, JSON.stringify(value));
    },
    async deleteMeta(key) {
      await db.runAsync('DELETE FROM meta WHERE key = ?', key);
    },
    async listRecords() {
      return (await db.getAllAsync<{ json: string }>('SELECT json FROM records')).map((r) => decodeRecord(r.json));
    },
    async putRecords(records) {
      await db.withTransactionAsync(async () => {
        for (const r of records) await db.runAsync('INSERT OR REPLACE INTO records (id, json) VALUES (?, ?)', r.id, encodeRecord(r));
      });
    },
    async deleteRecords(ids) {
      await db.withTransactionAsync(async () => {
        for (const id of ids) await db.runAsync('DELETE FROM records WHERE id = ?', id);
      });
    },
    async getBlob(id) {
      const row = await db.getFirstAsync<{ id: string; uploaded: number; local_only: number; envelope: Uint8Array }>('SELECT * FROM blobs WHERE id = ?', id);
      return row ? { id: row.id, uploaded: Boolean(row.uploaded), localOnly: Boolean(row.local_only), envelope: row.envelope } : undefined;
    },
    async putBlob(b: StoredBlob) {
      await db.runAsync('INSERT OR REPLACE INTO blobs (id, uploaded, local_only, envelope) VALUES (?, ?, ?, ?)', b.id, b.uploaded ? 1 : 0, b.localOnly ? 1 : 0, b.envelope);
    },
    async deleteBlob(id) {
      await db.runAsync('DELETE FROM blobs WHERE id = ?', id);
    },
    async listBlobs() {
      return (await db.getAllAsync<{ id: string; uploaded: number; local_only: number }>('SELECT id, uploaded, local_only FROM blobs')).map((r) => ({ id: r.id, uploaded: Boolean(r.uploaded), localOnly: Boolean(r.local_only) }));
    },
    async clearAll() {
      await db.execAsync('DELETE FROM meta; DELETE FROM records; DELETE FROM blobs;');
    },
  };
}
