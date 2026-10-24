// People operations initiated by the user from S07–S10. None of these are reachable from the
// assistant (PolicyGateway exposes read-only tools only).
import { pairKey } from './domain/duplicates';
import { normalizeEmail, normalizePhone } from './domain/normalize';
import type { Contact, Entity } from './domain/schemas';
import type { VaultSession } from './store/session';

export async function decideDuplicate(session: VaultSession, a: string, b: string, decision: 'different' | 'later'): Promise<void> {
  const key = pairKey(a, b);
  const existing = session.all('duplicateDecision').find((d) => d.pairKey === key);
  const entity = existing ? { ...existing, decision } : session.build('duplicateDecision', { pairKey: key, subjectIds: a < b ? [a, b] : [b, a], decision });
  await session.commit([entity], { action: 'duplicate.decision', count: 1 });
}

/**
 * Explicit user merge: everything attached to `mergeId` moves to `keepId`, contact details are
 * unioned, previous affiliations are kept as history, and `mergeId` is deleted.
 */
export async function mergeContacts(session: VaultSession, keepId: string, mergeId: string): Promise<void> {
  if (keepId === mergeId) throw new Error('同じ人物は統合できません');
  const keep = session.get(keepId, 'contact');
  const merge = session.get(mergeId, 'contact');
  if (!keep || !merge) throw new Error('人物が見つかりません');
  const emails = [...keep.emails];
  for (const e of merge.emails) if (!emails.some((x) => normalizeEmail(x) === normalizeEmail(e))) emails.push(e);
  const phones = [...keep.phones];
  for (const p of merge.phones) if (!phones.some((x) => normalizePhone(x.value) === normalizePhone(p.value))) phones.push(p);
  const changes: Entity[] = [
    {
      ...keep,
      emails: emails.slice(0, 10),
      phones: phones.slice(0, 10),
      tags: [...new Set([...keep.tags, ...merge.tags])].slice(0, 30),
      note: [keep.note, merge.note].filter(Boolean).join('\n---\n').slice(0, 4000) || undefined,
      fullNameKana: keep.fullNameKana ?? merge.fullNameKana,
    } satisfies Contact,
  ];
  const keepHasCurrent = session.all('affiliation').some((a) => a.contactId === keepId && a.current);
  for (const e of session.all('affiliation')) if (e.contactId === mergeId) changes.push({ ...e, contactId: keepId, current: keepHasCurrent ? false : e.current });
  for (const e of session.all('card')) if (e.contactId === mergeId) changes.push({ ...e, contactId: keepId });
  for (const e of session.all('encounter')) if (e.contactId === mergeId) changes.push({ ...e, contactId: keepId });
  for (const e of session.all('followup')) if (e.contactId === mergeId) changes.push({ ...e, contactId: keepId });
  changes.push(session.build('duplicateDecision', { pairKey: pairKey(keepId, mergeId), subjectIds: keepId < mergeId ? [keepId, mergeId] : [mergeId, keepId], decision: 'same_person' }));
  await session.commit(changes, { action: 'duplicate.decision', count: 1 });
  await session.remove([mergeId]);
}

/** Deletes a person and everything attached (cards, images, encounters, tasks, affiliations). */
export async function deleteContact(session: VaultSession, contactId: string): Promise<void> {
  const ids = [contactId];
  for (const t of ['affiliation', 'encounter', 'followup'] as const) for (const e of session.all(t)) if (e.contactId === contactId) ids.push(e.id);
  for (const c of session.all('card')) {
    if (c.contactId !== contactId) continue;
    ids.push(c.id);
    for (const b of [c.frontBlobId, c.backBlobId, c.thumbBlobId]) if (b) await session.deleteImage(b);
  }
  await session.remove(ids);
}
