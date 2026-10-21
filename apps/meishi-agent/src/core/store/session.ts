// Unlocked vault session: decrypted entities live only in this object's memory. Every write is
// validated (Zod), sealed with the record key and persisted before the in-memory copy changes.
import { recordAudit, type AuditAction } from '../audit';
import { openBlob, openRecord, sealBlob, sealRecord } from '../crypto/records';
import type { CryptoProvider } from '../crypto/provider';
import type { VaultKeys } from '../crypto/vault';
import { newId } from '../domain/ids';
import { Entity, LOCAL_ONLY_TYPES, type EntityOf, type EntityType } from '../domain/schemas';
import { buildIndex, type EntityIndex } from '../domain/views';
import type { EncryptedStore, StoredRecord } from './types';

export type NewEntity<T extends EntityType> = Omit<EntityOf<T>, 'id' | 'createdAt' | 'updatedAt' | 'version'> & { id?: string };

export interface SessionDeps {
  provider: CryptoProvider;
  store: EncryptedStore;
  now?: () => Date;
}

export interface LoadReport {
  loaded: number;
  unreadable: number;
}

export class VaultSession {
  private keys: VaultKeys | null = null;
  private entities = new Map<string, Entity>();
  private records = new Map<string, StoredRecord>();
  private listeners = new Set<() => void>();
  private cachedIndex: EntityIndex | null = null;
  private revision = 0;
  readonly provider: CryptoProvider;
  readonly store: EncryptedStore;
  private readonly now: () => Date;

  constructor(deps: SessionDeps) {
    this.provider = deps.provider;
    this.store = deps.store;
    this.now = deps.now ?? (() => new Date());
  }

  get unlocked(): boolean {
    return this.keys !== null;
  }

  get vaultId(): string | undefined {
    return this.keys?.vaultId;
  }

  /** Monotonic counter for React's useSyncExternalStore. */
  get snapshot(): number {
    return this.revision;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    this.cachedIndex = null;
    this.revision++;
    this.listeners.forEach((l) => l());
  }

  requireKeys(): VaultKeys {
    if (!this.keys) throw new LockedError();
    return this.keys;
  }

  async open(keys: VaultKeys): Promise<LoadReport> {
    this.keys = keys;
    this.entities.clear();
    this.records.clear();
    let unreadable = 0;
    for (const r of await this.store.listRecords()) {
      this.records.set(r.id, r);
      if (r.deleted || !r.envelope) continue;
      try {
        const parsed = Entity.safeParse(await openRecord(this.provider, keys, r.id, r.envelope));
        if (parsed.success && parsed.data.id === r.id) this.entities.set(r.id, parsed.data);
        else unreadable++;
      } catch {
        unreadable++;
      }
    }
    this.changed();
    return { loaded: this.entities.size, unreadable };
  }

  /** Drops keys and every decrypted object reference (GC timing is up to the JS engine). */
  lock(): void {
    this.keys = null;
    this.entities.clear();
    this.records.clear();
    this.changed();
  }

  get index(): EntityIndex {
    if (!this.cachedIndex) this.cachedIndex = buildIndex(this.entities.values());
    return this.cachedIndex;
  }

  get<T extends EntityType>(id: string, type: T): EntityOf<T> | undefined {
    const e = this.entities.get(id);
    return e && e.type === type ? (e as EntityOf<T>) : undefined;
  }

  getAny(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  all<T extends EntityType>(type: T): EntityOf<T>[] {
    return [...this.entities.values()].filter((e): e is EntityOf<T> => e.type === type);
  }

  record(id: string): StoredRecord | undefined {
    return this.records.get(id);
  }

  allRecords(): StoredRecord[] {
    return [...this.records.values()];
  }

  newId(kind: EntityType | 'blob' | 'session'): string {
    return newId(kind, (n) => this.provider.randomBytes(n));
  }

  build<T extends EntityType>(type: T, fields: NewEntity<T>): EntityOf<T> {
    const ts = this.now().toISOString();
    return Entity.parse({ ...fields, type, id: fields.id ?? this.newId(type), createdAt: ts, updatedAt: ts, version: 1 }) as EntityOf<T>;
  }

  /** Persists creations/updates atomically. Updates must pass the full entity with its current version. */
  async commit(changes: Entity[], audit?: { action: AuditAction; count?: number }): Promise<void> {
    const keys = this.requireKeys();
    const ts = this.now().toISOString();
    const nextEntities: Entity[] = [];
    const nextRecords: StoredRecord[] = [];
    for (const change of changes) {
      const existing = this.entities.get(change.id);
      const prevRecord = this.records.get(change.id);
      const version = existing ? Math.max(existing.version, prevRecord?.maxVersion ?? 0) + 1 : Math.max(change.version, (prevRecord?.maxVersion ?? 0) + 1);
      const entity = Entity.parse({ ...change, version, updatedAt: existing ? ts : change.updatedAt });
      const localOnly = LOCAL_ONLY_TYPES.has(entity.type);
      nextEntities.push(entity);
      nextRecords.push({
        id: entity.id,
        envelope: await sealRecord(this.provider, keys, entity.id, entity),
        localOnly,
        deleted: false,
        dirty: !localOnly,
        serverRevision: prevRecord?.serverRevision ?? null,
        maxVersion: version,
        conflict: prevRecord?.conflict,
      });
    }
    await this.store.putRecords(nextRecords);
    nextRecords.forEach((r) => this.records.set(r.id, r));
    nextEntities.forEach((e) => this.entities.set(e.id, e));
    if (audit) await recordAudit(this.store, audit.action, audit.count ?? changes.length, 'success', this.now());
    this.changed();
  }

  /** Deletes entities. Synced ones leave a tombstone so the deletion propagates to other devices. */
  async remove(ids: string[], audit = true): Promise<void> {
    this.requireKeys();
    const tombstones: StoredRecord[] = [];
    const purge: string[] = [];
    for (const id of ids) {
      const r = this.records.get(id);
      if (!r) continue;
      if (r.localOnly || r.serverRevision === null) purge.push(id);
      else tombstones.push({ ...r, envelope: null, deleted: true, dirty: true, maxVersion: r.maxVersion + 1 });
    }
    await this.store.putRecords(tombstones);
    await this.store.deleteRecords(purge);
    tombstones.forEach((r) => this.records.set(r.id, r));
    purge.forEach((id) => this.records.delete(id));
    ids.forEach((id) => this.entities.delete(id));
    if (audit) await recordAudit(this.store, 'record.delete', ids.length, 'success', this.now());
    this.changed();
  }

  async putImage(bytes: Uint8Array, localOnly = false): Promise<string> {
    const keys = this.requireKeys();
    const id = this.newId('blob');
    await this.store.putBlob({ id, envelope: await sealBlob(this.provider, keys, id, bytes), uploaded: false, localOnly });
    return id;
  }

  async getImage(id: string, fetchRemote?: (id: string) => Promise<Uint8Array | null>): Promise<Uint8Array | null> {
    const keys = this.requireKeys();
    let blob = await this.store.getBlob(id);
    if (!blob && fetchRemote) {
      const env = await fetchRemote(id);
      if (!env) return null;
      const plain = await openBlob(this.provider, keys, id, env); // verify before caching
      await this.store.putBlob({ id, envelope: env, uploaded: true, localOnly: false });
      return plain;
    }
    return blob ? openBlob(this.provider, keys, id, blob.envelope) : null;
  }

  async deleteImage(id: string): Promise<void> {
    await this.store.deleteBlob(id);
  }

  // ---- used by the sync engine -------------------------------------------------------------

  async applyRecords(records: StoredRecord[], entities: Entity[], removedIds: string[]): Promise<void> {
    await this.store.putRecords(records);
    records.forEach((r) => this.records.set(r.id, r));
    entities.forEach((e) => this.entities.set(e.id, e));
    removedIds.forEach((id) => this.entities.delete(id));
    this.changed();
  }

  async decryptEnvelope(id: string, envelope: Uint8Array): Promise<Entity> {
    const parsed = Entity.parse(await openRecord(this.provider, this.requireKeys(), id, envelope));
    if (parsed.id !== id) throw new Error('object id mismatch');
    return parsed;
  }

  async audit(action: AuditAction, count = 1, outcome: 'success' | 'failure' | 'denied' = 'success'): Promise<void> {
    await recordAudit(this.store, action, count, outcome, this.now());
  }

  get pendingCount(): number {
    let n = 0;
    for (const r of this.records.values()) if (r.dirty && !r.localOnly) n++;
    return n;
  }

  get conflicts(): StoredRecord[] {
    return [...this.records.values()].filter((r) => r.conflict);
  }
}

export class LockedError extends Error {
  constructor() {
    super('保管庫がロックされています');
    this.name = 'LockedError';
  }
}
