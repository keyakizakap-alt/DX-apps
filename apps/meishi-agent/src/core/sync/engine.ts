// E2EE sync: push dirty ciphertext with the revision it was based on, pull the server change log,
// and surface conflicts instead of last-write-wins. Local edits are never discarded by a failure.
import { fromBase64, toBase64 } from '../crypto/bytes';
import type { Entity } from '../domain/schemas';
import type { VaultSession } from '../store/session';
import type { StoredRecord } from '../store/types';
import { MAX_PULL, MAX_PUSH, SyncHttpError, type RemoteObject, type SyncTransport } from './protocol';

export interface SyncState {
  cursor: number;
  deviceId: string;
  lastSyncAt?: string;
  lastError?: SyncHttpError['code'];
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  conflicts: number;
  rejected: number;
  blobsUploaded: number;
}

export class SyncEngine {
  private running: Promise<SyncReport> | null = null;

  constructor(
    private readonly session: VaultSession,
    private readonly transport: SyncTransport,
    private readonly state: { load(): Promise<SyncState>; save(s: SyncState): Promise<void> },
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Serialises concurrent sync requests. */
  sync(): Promise<SyncReport> {
    if (!this.running) this.running = this.run().finally(() => (this.running = null));
    return this.running;
  }

  private async run(): Promise<SyncReport> {
    const state = await this.state.load();
    const report: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, rejected: 0, blobsUploaded: 0 };
    try {
      report.blobsUploaded = await this.uploadBlobs();
      await this.push(state, report);
      await this.pull(state, report);
      state.lastSyncAt = this.now().toISOString();
      delete state.lastError;
      await this.state.save(state);
      if (report.pushed) await this.session.audit('sync.push', report.pushed);
      if (report.pulled) await this.session.audit('sync.pull', report.pulled);
      if (report.conflicts) await this.session.audit('sync.conflict', report.conflicts);
      if (report.rejected) await this.session.audit('sync.rollback_rejected', report.rejected, 'denied');
      return report;
    } catch (error) {
      state.lastError = error instanceof SyncHttpError ? error.code : 'offline';
      await this.state.save(state);
      await this.session.audit('sync.error', 1, 'failure');
      throw error;
    }
  }

  private async uploadBlobs(): Promise<number> {
    let n = 0;
    for (const meta of await this.session.store.listBlobs()) {
      if (meta.uploaded || meta.localOnly) continue;
      const blob = await this.session.store.getBlob(meta.id);
      if (!blob) continue;
      await this.transport.putBlob(blob.id, blob.envelope);
      await this.session.store.putBlob({ ...blob, uploaded: true });
      n++;
    }
    return n;
  }

  private async push(state: SyncState, report: SyncReport) {
    const dirty = this.session.allRecords().filter((r) => r.dirty && !r.localOnly && !r.conflict);
    for (let i = 0; i < dirty.length; i += MAX_PUSH) {
      const batch = dirty.slice(i, i + MAX_PUSH);
      const results = await this.transport.push({
        deviceId: state.deviceId,
        changes: batch.map((r) => ({ objectId: r.id, baseRevision: r.serverRevision, deleted: r.deleted, envelope: r.envelope ? toBase64(r.envelope) : null })),
      });
      const updated: StoredRecord[] = [];
      for (const res of results) {
        const local = batch.find((r) => r.id === res.objectId);
        if (!local) continue;
        if (res.status === 'ok') {
          updated.push({ ...local, dirty: false, serverRevision: res.revision });
          report.pushed++;
        } else {
          updated.push({ ...local, conflict: toConflict(res.current, this.now()) });
          report.conflicts++;
        }
      }
      // The local record may have been edited while the request was in flight; keep the newer one dirty.
      const fresh = updated.map((u) => {
        const current = this.session.record(u.id);
        return current && current.maxVersion > u.maxVersion ? { ...current, serverRevision: u.serverRevision, conflict: u.conflict } : u;
      });
      await this.session.applyRecords(fresh, [], []);
      // Tombstones that the server acknowledged can be dropped locally.
      const acked = fresh.filter((r) => r.deleted && !r.dirty).map((r) => r.id);
      if (acked.length) await this.session.store.deleteRecords(acked);
    }
  }

  private async pull(state: SyncState, report: SyncReport) {
    for (;;) {
      const page = await this.transport.pull(state.cursor, MAX_PULL);
      const records: StoredRecord[] = [];
      const entities: Entity[] = [];
      const removed: string[] = [];
      for (const remote of page.changes) {
        const local = this.session.record(remote.objectId);
        if (local && local.serverRevision !== null && remote.revision <= local.serverRevision) continue; // echo of our own push
        if (local?.conflict) {
          // Already awaiting a user decision: track the newest remote copy without re-counting.
          if (remote.revision > local.conflict.revision) records.push({ ...local, conflict: toConflict(remote, this.now()) });
          continue;
        }
        if (local?.dirty) {
          records.push({ ...local, conflict: toConflict(remote, this.now()) });
          report.conflicts++;
          continue;
        }
        if (remote.deleted || !remote.envelope) {
          records.push({ id: remote.objectId, envelope: null, deleted: true, dirty: false, localOnly: false, serverRevision: remote.revision, maxVersion: local?.maxVersion ?? 0 });
          removed.push(remote.objectId);
          report.pulled++;
          continue;
        }
        const envelope = fromBase64(remote.envelope);
        let entity: Entity;
        try {
          entity = await this.session.decryptEnvelope(remote.objectId, envelope);
        } catch {
          report.rejected++; // tampered, wrong vault, or schema-invalid ciphertext: never applied
          continue;
        }
        if (local && entity.version < local.maxVersion) {
          report.rejected++; // server replayed an older version
          continue;
        }
        records.push({ id: remote.objectId, envelope, deleted: false, dirty: false, localOnly: false, serverRevision: remote.revision, maxVersion: entity.version });
        entities.push(entity);
        report.pulled++;
      }
      await this.session.applyRecords(records, entities, removed);
      state.cursor = page.cursor;
      await this.state.save(state);
      if (!page.hasMore) break;
    }
  }

  /** User decision for a conflicted object (S13). Never chosen automatically. */
  async resolveConflict(objectId: string, choice: 'keep_local' | 'keep_remote' | 'keep_both'): Promise<void> {
    const local = this.session.record(objectId);
    if (!local?.conflict) throw new Error('no conflict for this object');
    const remote = local.conflict;
    const remoteEntity = remote.envelope && !remote.deleted ? await this.session.decryptEnvelope(objectId, remote.envelope) : undefined;
    if (choice === 'keep_local') {
      // Re-seal the local copy with a version above the remote one so that other devices accept it
      // (they reject versions lower than what they have seen as a rollback).
      const maxVersion = Math.max(local.maxVersion, remoteEntity?.version ?? 0);
      await this.session.applyRecords([{ ...local, conflict: undefined, dirty: true, serverRevision: remote.revision, maxVersion }], [], []);
      const mine = this.session.getAny(objectId);
      if (mine) await this.session.commit([mine]);
    } else {
      let copy: Entity | undefined;
      if (choice === 'keep_both') {
        const mine = this.session.get(objectId, 'contact') ?? this.session.get(objectId, 'encounter');
        if (!mine) throw new Error('keep_both is only available for people and encounters');
        copy = { ...mine, id: this.session.newId(mine.type), version: 1 } as Entity;
      }
      if (!remoteEntity || !remote.envelope) {
        await this.session.applyRecords([{ id: objectId, envelope: null, deleted: true, dirty: false, localOnly: false, serverRevision: remote.revision, maxVersion: local.maxVersion }], [], [objectId]);
      } else {
        // The user explicitly accepted the remote copy, so its version becomes the new baseline.
        await this.session.applyRecords([{ id: objectId, envelope: remote.envelope, deleted: false, dirty: false, localOnly: false, serverRevision: remote.revision, maxVersion: remoteEntity.version }], [remoteEntity], []);
      }
      if (copy) await this.session.commit([copy]);
    }
    await this.session.audit('sync.conflict_resolved');
  }
}

function toConflict(remote: RemoteObject, now: Date) {
  return { revision: remote.revision, deleted: remote.deleted, envelope: remote.envelope ? fromBase64(remote.envelope) : null, detectedAt: now.toISOString() };
}
