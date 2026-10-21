// External-AI request contract, shared verbatim by the device and the server proxy.
// Must only import 'zod' (the server loads this file directly with Node type stripping).
import { z } from 'zod';

/** Fields a draft request may carry. E-mail addresses and phone numbers are not representable. */
export const AI_FIELD_LABELS = {
  recipientName: '相手の氏名',
  company: '会社名',
  department: '部署',
  title: '役職',
  encounterDate: '会った日',
  event: 'イベント',
  conversation: '会話メモ',
  nextAction: '次の行動',
} as const;
export type AiFieldKey = keyof typeof AI_FIELD_LABELS;

const fieldText = (max: number) => z.string().trim().min(1).max(max);

export const ExternalDraftRequest = z
  .object({
    purpose: z.literal('draft_email'),
    destination: z.string().max(100),
    subjectCount: z.literal(1),
    tone: z.enum(['formal', 'friendly']),
    fields: z
      .object({
        recipientName: fieldText(80).optional(),
        company: fieldText(120).optional(),
        department: fieldText(120).optional(),
        title: fieldText(120).optional(),
        encounterDate: z.iso.date().optional(),
        event: fieldText(120).optional(),
        conversation: fieldText(1500).optional(),
        nextAction: fieldText(400).optional(),
      })
      .strict(),
  })
  .strict();
export type ExternalDraftRequest = z.infer<typeof ExternalDraftRequest>;

export const MAX_REQUEST_CHARS = 4000;

export const DraftResult = z.object({
  subject: z.string().max(200),
  body: z.string().max(4000),
  caveats: z.array(z.string().max(300)).max(5),
});
export type DraftResult = z.infer<typeof DraftResult>;

/** Deterministic JSON (sorted keys, no whitespace) so device and server hash the same bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export async function requestHash(req: ExternalDraftRequest): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(req)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
