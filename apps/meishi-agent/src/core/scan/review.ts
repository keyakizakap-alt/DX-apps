// S06/S07: turning a reviewed card into people data. Every path is an explicit user decision;
// attaching to an existing person keeps the old affiliation as history instead of overwriting it.
import { pairKey } from '../domain/duplicates';
import { normalizeCompany, normalizeEmail, normalizePhone } from '../domain/normalize';
import { fieldValue, parseCardText } from '../domain/ocr-parse';
import type { Affiliation, BusinessCard, CardField, Contact, Entity, Organization, Phone, ScanItem } from '../domain/schemas';
import type { VaultSession } from '../store/session';

export type ReviewDecision = { kind: 'new_person' } | { kind: 'same_person'; contactId: string } | { kind: 'hold' };

export class ReviewValidationError extends Error {}

export function initialFields(item: ScanItem): CardField[] {
  return parseCardText(item.ocrLines ?? []);
}

function findOrCreateOrg(session: VaultSession, name: string): { org: Organization; created: boolean } {
  const key = normalizeCompany(name);
  const existing = session.all('organization').find((o) => normalizeCompany(o.name) === key);
  return existing ? { org: existing, created: false } : { org: session.build('organization', { name }), created: true };
}

function phonesFrom(fields: CardField[]): Phone[] {
  const out: Phone[] = [];
  for (const f of fields) {
    if (!f.value) continue;
    if (f.key === 'mobile') out.push({ kind: 'mobile', value: f.value });
    if (f.key === 'phone') out.push({ kind: 'office', value: f.value });
    if (f.key === 'fax') out.push({ kind: 'fax', value: f.value });
  }
  return out;
}

const today = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Saves a reviewed card. `item` may be undefined when the user typed a card manually.
 * Returns the ids written so the UI can navigate.
 */
export async function saveReviewedCard(
  session: VaultSession,
  input: { item?: ScanItem; fields: CardField[]; decision: ReviewDecision; exchangedAt?: string; dismissContactIds?: string[] },
  now = new Date(),
): Promise<{ cardId: string; contactId?: string }> {
  const fields = input.fields.filter((f) => f.value.trim() !== '');
  const fullName = fieldValue(fields, 'fullName')?.trim();
  const company = fieldValue(fields, 'company')?.trim();
  if (input.decision.kind !== 'hold' && (!fullName || !company)) throw new ReviewValidationError('氏名と会社名は必須です。分からない場合は「保留」にしてください。');
  const emails = fields.filter((f) => f.key === 'email').map((f) => normalizeEmail(f.value));
  for (const e of emails) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ReviewValidationError(`メールアドレスの形式が正しくありません: ${e}`);
  const unverified = fields.some((f) => !f.verified);
  const changes: Entity[] = [];
  const item = input.item;
  const card: BusinessCard = session.build('card', {
    fields,
    frontBlobId: item?.frontBlobId,
    backBlobId: item?.backBlobId,
    ocrText: item?.ocrLines?.map((l) => l.text).join('\n').slice(0, 8000),
    ocrEngine: item?.ocrLines?.length ? 'tesseract-jpn' : 'manual',
    exchangedAt: input.exchangedAt ?? today(now),
    status: input.decision.kind === 'hold' ? 'on_hold' : unverified ? 'needs_review' : 'confirmed',
  });
  let contactId: string | undefined;

  if (input.decision.kind === 'new_person') {
    const { org, created } = findOrCreateOrg(session, company!);
    if (created) changes.push(org);
    const contact: Contact = session.build('contact', {
      fullName: fullName!,
      fullNameKana: fieldValue(fields, 'fullNameKana'),
      emails: [...new Set(emails)],
      phones: phonesFrom(fields),
      tags: [],
      status: unverified ? 'needs_review' : 'confirmed',
    });
    contactId = contact.id;
    changes.push(contact, session.build('affiliation', { contactId, organizationId: org.id, department: fieldValue(fields, 'department'), title: fieldValue(fields, 'title'), current: true, cardId: card.id, observedAt: card.exchangedAt }));
    for (const other of input.dismissContactIds ?? []) {
      changes.push(session.build('duplicateDecision', { pairKey: pairKey(contactId, other), subjectIds: [contactId, other], decision: 'different' }));
    }
  } else if (input.decision.kind === 'same_person') {
    const contact = session.get(input.decision.contactId, 'contact');
    if (!contact) throw new ReviewValidationError('追加先の人物が見つかりません');
    contactId = contact.id;
    const view = session.index.views.get(contact.id);
    const knownEmails = new Set(contact.emails.map(normalizeEmail));
    const knownPhones = new Set(contact.phones.map((p) => normalizePhone(p.value)));
    changes.push({
      ...contact,
      emails: [...contact.emails, ...emails.filter((e) => !knownEmails.has(e))].slice(0, 10),
      phones: [...contact.phones, ...phonesFrom(fields).filter((p) => !knownPhones.has(normalizePhone(p.value)))].slice(0, 10),
    });
    const { org, created } = findOrCreateOrg(session, company!);
    if (created) changes.push(org);
    const current = view?.current?.affiliation;
    const title = fieldValue(fields, 'title');
    const department = fieldValue(fields, 'department');
    const sameAffiliation = current && current.organizationId === org.id && (current.title ?? '') === (title ?? '') && (current.department ?? '') === (department ?? '');
    if (!sameAffiliation) {
      // 異動・転職: the previous affiliation stays as history (current=false), never deleted.
      for (const h of view?.history ?? []) if (h.affiliation.current) changes.push({ ...h.affiliation, current: false } satisfies Affiliation);
      changes.push(session.build('affiliation', { contactId, organizationId: org.id, department, title, current: true, cardId: card.id, observedAt: card.exchangedAt }));
    }
  }

  changes.push({ ...card, contactId });
  if (item) changes.push({ ...item, status: 'done', cardId: card.id });
  await session.commit(changes, { action: 'record.create', count: 1 });
  if (input.decision.kind === 'same_person') await session.audit('duplicate.decision');
  return { cardId: card.id, contactId };
}
