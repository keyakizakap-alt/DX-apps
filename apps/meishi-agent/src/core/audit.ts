// Audit trail: timestamp, action, count and outcome only. No names, e-mails, card text or ids
// of people are accepted by the type, and `recordAudit` rejects free text (SEC-14).
import { META, type EncryptedStore } from './store/types';

export const AUDIT_ACTIONS = [
  'vault.create', 'vault.unlock', 'vault.unlock_failed', 'vault.lock', 'vault.passcode_set', 'vault.passcode_cleared',
  'record.create', 'record.update', 'record.delete', 'scan.import', 'scan.ocr', 'duplicate.decision',
  'sync.push', 'sync.pull', 'sync.conflict', 'sync.conflict_resolved', 'sync.rollback_rejected', 'sync.error',
  'ai.local_query', 'ai.external_preview', 'ai.external_approved', 'ai.external_denied', 'ai.external_sent', 'ai.external_failed', 'ai.policy_denied',
  'export.backup', 'export.csv', 'data.wipe_local', 'account.delete', 'auth.sign_in', 'auth.sign_out', 'settings.change',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEvent {
  at: string;
  action: AuditAction;
  count: number;
  outcome: 'success' | 'failure' | 'denied';
}

const MAX_EVENTS = 1000;

export async function recordAudit(store: EncryptedStore, action: AuditAction, count = 1, outcome: AuditEvent['outcome'] = 'success', now = new Date()): Promise<void> {
  if (!AUDIT_ACTIONS.includes(action) || !Number.isInteger(count) || count < 0) throw new Error('invalid audit event');
  const list = (await store.getMeta<AuditEvent[]>(META.audit)) ?? [];
  list.push({ at: now.toISOString(), action, count, outcome });
  await store.setMeta(META.audit, list.slice(-MAX_EVENTS));
}

export async function readAudit(store: EncryptedStore): Promise<AuditEvent[]> {
  return ((await store.getMeta<AuditEvent[]>(META.audit)) ?? []).slice().reverse();
}
