// S15: encrypted backup (default) and plaintext CSV (requires recovery-key re-authentication).
import { fromBase64, toBase64 } from './crypto/bytes';
import { parseRecoveryKey } from './crypto/recovery-key';
import { unlockWithRecoveryKey, type RecoveryEnvelope } from './crypto/vault';
import type { VaultSession } from './store/session';
import type { StoredRecord } from './store/types';

export interface EncryptedBackup {
  format: 'meishi-backup/v1';
  createdAt: string;
  recoveryEnvelope: RecoveryEnvelope;
  records: Array<{ id: string; localOnly: boolean; envelope: string }>;
  blobs: Array<{ id: string; envelope: string }>;
}

export async function createEncryptedBackup(session: VaultSession, recoveryEnvelope: RecoveryEnvelope, includeImages: boolean, now = new Date()): Promise<EncryptedBackup> {
  session.requireKeys();
  const records = session
    .allRecords()
    .filter((r): r is StoredRecord & { envelope: Uint8Array } => !r.deleted && r.envelope !== null && !r.localOnly)
    .map((r) => ({ id: r.id, localOnly: r.localOnly, envelope: toBase64(r.envelope) }));
  const blobs: EncryptedBackup['blobs'] = [];
  if (includeImages) {
    for (const meta of await session.store.listBlobs()) {
      if (meta.localOnly) continue;
      const b = await session.store.getBlob(meta.id);
      if (b) blobs.push({ id: b.id, envelope: toBase64(b.envelope) });
    }
  }
  await session.audit('export.backup', records.length);
  return { format: 'meishi-backup/v1', createdAt: now.toISOString(), recoveryEnvelope, records, blobs };
}

/** Restores a backup into an unlocked session of the same vault. Existing newer copies are kept. */
export async function restoreEncryptedBackup(session: VaultSession, backup: EncryptedBackup): Promise<{ restored: number; skipped: number }> {
  const keys = session.requireKeys();
  if (backup.format !== 'meishi-backup/v1' || backup.recoveryEnvelope.vaultId !== keys.vaultId) throw new Error('この保管庫のバックアップではありません');
  let restored = 0;
  let skipped = 0;
  const entities = [];
  const records: StoredRecord[] = [];
  for (const r of backup.records) {
    const envelope = fromBase64(r.envelope);
    try {
      const entity = await session.decryptEnvelope(r.id, envelope); // authenticates every record
      const existing = session.record(r.id);
      if (existing && existing.maxVersion >= entity.version) {
        skipped++;
        continue;
      }
      records.push({ id: r.id, envelope, localOnly: false, deleted: false, dirty: true, serverRevision: existing?.serverRevision ?? null, maxVersion: entity.version });
      entities.push(entity);
      restored++;
    } catch {
      skipped++;
    }
  }
  await session.applyRecords(records, entities, []);
  for (const b of backup.blobs) if (!(await session.store.getBlob(b.id))) await session.store.putBlob({ id: b.id, envelope: fromBase64(b.envelope), uploaded: false, localOnly: false });
  return { restored, skipped };
}

/** Re-authentication for plaintext export / destructive actions: the recovery key must open this vault. */
export async function verifyRecoveryKey(session: VaultSession, envelope: RecoveryEnvelope, recoveryKey: string): Promise<boolean> {
  try {
    await parseRecoveryKey(recoveryKey, session.provider.sha256);
    await unlockWithRecoveryKey(session.provider, envelope, recoveryKey);
    return true;
  } catch {
    return false;
  }
}

function csvCell(value: string | undefined): string {
  let v = (value ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`; // spreadsheet formula injection guard
  return `"${v.replace(/"/g, '""')}"`;
}

export function contactsToCsv(session: VaultSession, ids?: string[]): { csv: string; count: number } {
  const header = ['氏名', 'よみ', '会社', '部署', '役職', 'メール', '電話', 'タグ', '最終面会日', '確認状態'];
  const rows = [...session.index.views.values()]
    .filter((v) => !ids || ids.includes(v.contact.id))
    .map((v) =>
      [
        v.contact.fullName,
        v.contact.fullNameKana,
        v.current?.organization?.name,
        v.current?.affiliation.department,
        v.current?.affiliation.title,
        v.contact.emails.join(' / '),
        v.contact.phones.map((p) => p.value).join(' / '),
        v.contact.tags.join(' / '),
        v.lastMetAt,
        { confirmed: '確認済み', needs_review: '要確認', on_hold: '保留' }[v.contact.status],
      ].map(csvCell).join(','),
    );
  // BOM so that Excel on Windows opens UTF-8 Japanese correctly.
  return { csv: `﻿${header.map(csvCell).join(',')}\r\n${rows.join('\r\n')}\r\n`, count: rows.length };
}
