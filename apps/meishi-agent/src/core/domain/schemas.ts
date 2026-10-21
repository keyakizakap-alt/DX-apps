// Domain entities. Every entity is persisted as its own encrypted record (one SyncObject each).
import { z } from 'zod';

const id = z.string().regex(/^[a-z]{1,4}_[0-9a-f]{24}$/, 'invalid id');
const isoDateTime = z.iso.datetime();
const isoDate = z.iso.date();
const shortText = (max: number) => z.string().trim().max(max);

export const ReviewStatus = z.enum(['needs_review', 'confirmed', 'on_hold']);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

const base = {
  id,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  /** Monotonic per-object edit counter. Used to detect server rollback/replay. */
  version: z.number().int().min(1),
};

export const PhoneKind = z.enum(['office', 'mobile', 'fax', 'other']);
export const Phone = z.object({ kind: PhoneKind, value: shortText(40) });
export type Phone = z.infer<typeof Phone>;

export const Contact = z.object({
  ...base,
  type: z.literal('contact'),
  fullName: shortText(80).min(1, '氏名は必須です'),
  fullNameKana: shortText(80).optional(),
  emails: z.array(z.email().max(254)).max(10),
  phones: z.array(Phone).max(10),
  tags: z.array(shortText(30).min(1)).max(30),
  status: ReviewStatus,
  note: shortText(4000).optional(),
});
export type Contact = z.infer<typeof Contact>;

export const Organization = z.object({
  ...base,
  type: z.literal('organization'),
  name: shortText(120).min(1, '会社名は必須です'),
  nameKana: shortText(120).optional(),
});
export type Organization = z.infer<typeof Organization>;

export const Affiliation = z.object({
  ...base,
  type: z.literal('affiliation'),
  contactId: id,
  organizationId: id,
  department: shortText(120).optional(),
  title: shortText(120).optional(),
  current: z.boolean(),
  /** Card the affiliation was read from, if any. Past affiliations are never deleted automatically. */
  cardId: id.optional(),
  observedAt: isoDate.optional(),
});
export type Affiliation = z.infer<typeof Affiliation>;

export const CardFieldKey = z.enum(['fullName', 'fullNameKana', 'company', 'department', 'title', 'email', 'phone', 'mobile', 'fax', 'address', 'url']);
export type CardFieldKey = z.infer<typeof CardFieldKey>;

export const CardField = z.object({
  key: CardFieldKey,
  /** Exactly what OCR produced; kept separate from the corrected value. */
  ocrValue: shortText(400).optional(),
  value: shortText(400),
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(['ocr', 'user', 'ai_suggestion']),
  verified: z.boolean(),
});
export type CardField = z.infer<typeof CardField>;

export const BusinessCard = z.object({
  ...base,
  type: z.literal('card'),
  contactId: id.optional(),
  frontBlobId: id.optional(),
  backBlobId: id.optional(),
  thumbBlobId: id.optional(),
  fields: z.array(CardField).max(40),
  ocrText: shortText(8000).optional(),
  ocrEngine: z.enum(['tesseract-jpn', 'mlkit-ja', 'manual', 'demo']),
  exchangedAt: isoDate.optional(),
  status: ReviewStatus,
});
export type BusinessCard = z.infer<typeof BusinessCard>;

export const Encounter = z.object({
  ...base,
  type: z.literal('encounter'),
  contactId: id,
  date: isoDate,
  event: shortText(120).optional(),
  place: shortText(120).optional(),
  conversation: shortText(4000).optional(),
  nextAction: shortText(400).optional(),
  certainty: z.enum(['confirmed', 'memo', 'uncertain']),
});
export type Encounter = z.infer<typeof Encounter>;

export const Tag = z.object({ ...base, type: z.literal('tag'), name: shortText(30).min(1) });
export type Tag = z.infer<typeof Tag>;

export const FollowUpTask = z.object({
  ...base,
  type: z.literal('followup'),
  contactId: id,
  title: shortText(200).min(1),
  dueDate: isoDate.optional(),
  done: z.boolean(),
  source: z.enum(['user', 'assistant_suggestion']),
});
export type FollowUpTask = z.infer<typeof FollowUpTask>;

/** A human decision about a duplicate candidate pair. The app never merges on its own. */
export const DuplicateDecision = z.object({
  ...base,
  type: z.literal('duplicateDecision'),
  pairKey: z.string().max(80),
  subjectIds: z.tuple([id, id]),
  decision: z.enum(['same_person', 'different', 'later']),
});
export type DuplicateDecision = z.infer<typeof DuplicateDecision>;

export const ScanStatus = z.enum(['captured', 'queued', 'recognizing', 'needs_review', 'done', 'failed']);
export type ScanStatus = z.infer<typeof ScanStatus>;

/** Import queue item. Encrypted and local-only; survives reloads so a 50-card session can resume. */
export const ScanItem = z.object({
  ...base,
  type: z.literal('scanItem'),
  sessionId: id,
  index: z.number().int().min(0).max(49),
  status: ScanStatus,
  frontBlobId: id,
  backBlobId: id.optional(),
  sourceName: shortText(200).optional(),
  /** SHA-256 of the processed image, to warn about importing the same image twice. */
  imageHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  ocrLines: z.array(z.object({ text: shortText(400), confidence: z.number().min(0).max(1).optional() })).max(200).optional(),
  attempts: z.number().int().min(0).max(10),
  error: shortText(300).optional(),
  cardId: id.optional(),
});
export type ScanItem = z.infer<typeof ScanItem>;

export const ConsentGrant = z.object({
  ...base,
  type: z.literal('consent'),
  purpose: z.enum(['draft_email', 'summarize']),
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
  destination: z.string().max(200),
  fieldKeys: z.array(z.string().max(40)).max(20),
  subjectCount: z.number().int().min(0).max(5),
  expiresAt: isoDateTime,
  state: z.enum(['approved', 'used', 'expired', 'denied']),
});
export type ConsentGrant = z.infer<typeof ConsentGrant>;

export const Entity = z.discriminatedUnion('type', [Contact, Organization, Affiliation, BusinessCard, Encounter, Tag, FollowUpTask, DuplicateDecision, ScanItem, ConsentGrant]);
export type Entity = z.infer<typeof Entity>;
export type EntityType = Entity['type'];
export type EntityOf<T extends EntityType> = Extract<Entity, { type: T }>;

/** Entity types that stay on this device only (never sent to the sync server). */
export const LOCAL_ONLY_TYPES: ReadonlySet<EntityType> = new Set(['scanItem', 'consent']);

export const ID_PREFIX: Record<EntityType | 'blob' | 'session', string> = {
  contact: 'c',
  organization: 'o',
  affiliation: 'af',
  card: 'bc',
  encounter: 'en',
  tag: 't',
  followup: 'fu',
  duplicateDecision: 'dd',
  scanItem: 'si',
  consent: 'cg',
  blob: 'b',
  session: 'ss',
};
