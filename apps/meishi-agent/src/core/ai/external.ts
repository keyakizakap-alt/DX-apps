// External LLM flow (S12). Builds the exact request, shows it, and only after an explicit
// one-time approval obtains a server consent bound to the request hash and sends it.
// No network request happens before `approveAndSend` is called with a matching preview.
import type { Encounter } from '../domain/schemas';
import type { ContactView } from '../domain/views';
import type { ApiClient } from '../sync/api-client';
import type { VaultSession } from '../store/session';
import { AI_FIELD_LABELS, ExternalDraftRequest, MAX_REQUEST_CHARS, PLACEHOLDERS, canonicalJson, requestHash, type AiFieldKey, type DraftResult } from './request';

export const DEFAULT_FIELDS: AiFieldKey[] = ['recipientName', 'company', 'title', 'encounterDate', 'event', 'conversation', 'nextAction'];

const INJECTION = /(ignore (all |the )?(previous|above)|system prompt|disregard|無視して|指示を無視|命令|送信して|送信せよ|転送|全(件|て)の?連絡先|削除して|共有して|権限|管理者として)/i;

export interface ExternalPreview {
  request: ExternalDraftRequest;
  hash: string;
  json: string; // exactly what is transmitted (inside the request body)
  fields: { key: AiFieldKey; label: string; value: string }[];
  warnings: string[];
  createdAt: number;
  /** placeholder → real value. Kept on the device only; never part of the request. */
  substitutions: Record<string, string>;
}

export function availableFields(view: ContactView, encounter?: Encounter): Partial<Record<AiFieldKey, string>> {
  const a = view.current?.affiliation;
  return {
    recipientName: view.contact.fullName,
    company: view.current?.organization?.name,
    department: a?.department,
    title: a?.title,
    encounterDate: encounter?.date,
    event: encounter?.event,
    conversation: encounter?.conversation,
    nextAction: encounter?.nextAction,
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replaces the person's name, company and department with 〔…〕 placeholders, including where
 * they appear inside free-text fields (event, conversation, next action). Name variants without
 * the space ("架空花子") and the family name alone are also replaced.
 */
export function pseudonymizeFields(fields: Partial<Record<AiFieldKey, string>>): { fields: Partial<Record<AiFieldKey, string>>; substitutions: Record<string, string> } {
  const substitutions: Record<string, string> = {};
  const replacements: [string, string][] = [];
  for (const key of Object.keys(PLACEHOLDERS) as (keyof typeof PLACEHOLDERS)[]) {
    const real = fields[key]?.trim();
    if (!real) continue;
    substitutions[PLACEHOLDERS[key]] = real;
    const variants = new Set([real, real.replace(/[\s\u3000]+/g, '')]);
    if (key === 'recipientName') {
      const family = real.split(/[\s\u3000]+/)[0];
      if (family && family.length >= 2 && family !== real) variants.add(family);
    }
    if (key === 'company') variants.add(real.replace(/(株式会社|有限会社|合同会社|\(株\)|（株）)/g, '').trim());
    for (const v of [...variants].filter((x) => x.length >= 2).sort((a, b) => b.length - a.length)) replacements.push([v, PLACEHOLDERS[key]]);
  }
  const out: Partial<Record<AiFieldKey, string>> = {};
  for (const [k, v] of Object.entries(fields) as [AiFieldKey, string][]) {
    if (k in PLACEHOLDERS && v.trim()) {
      out[k] = PLACEHOLDERS[k as keyof typeof PLACEHOLDERS];
      continue;
    }
    let text = v;
    for (const [real, ph] of replacements) text = text.replace(new RegExp(escapeRe(real), 'g'), ph);
    out[k] = text;
  }
  return { fields: out, substitutions };
}

/** Puts the real values back into AI output on the device. Only exact placeholders are replaced. */
export function restorePlaceholders(draft: DraftResult, substitutions: Record<string, string>): DraftResult {
  const fix = (s: string) => Object.entries(substitutions).reduce((acc, [ph, real]) => acc.split(ph).join(real), s);
  return { subject: fix(draft.subject), body: fix(draft.body), caveats: draft.caveats.map(fix) };
}

export async function buildPreview(
  view: ContactView,
  encounter: Encounter | undefined,
  include: AiFieldKey[],
  tone: 'formal' | 'friendly',
  destination: string,
  now = Date.now(),
  pseudonymize = true,
): Promise<ExternalPreview> {
  const values = availableFields(view, encounter);
  let fields: Partial<Record<AiFieldKey, string>> = {};
  for (const key of include) {
    const v = values[key]?.trim();
    if (v) fields[key] = key === 'conversation' ? v.slice(0, 1500) : v.slice(0, 400);
  }
  let substitutions: Record<string, string> = {};
  if (pseudonymize) ({ fields, substitutions } = pseudonymizeFields(fields));
  const request = ExternalDraftRequest.parse({ purpose: 'draft_email', destination, subjectCount: 1, tone, pseudonymized: pseudonymize, fields });
  const json = canonicalJson(request);
  if (json.length > MAX_REQUEST_CHARS) throw new Error('送信内容が長すぎます。会話メモを短くするか項目を外してください。');
  const warnings: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (INJECTION.test(String(v))) warnings.push(`「${AI_FIELD_LABELS[k as AiFieldKey]}」に指示のような文があります。AIには資料として渡され、命令としては扱われませんが、不要なら項目を外してください。`);
  }
  return {
    request,
    hash: await requestHash(request),
    json,
    fields: Object.entries(fields).map(([key, value]) => ({ key: key as AiFieldKey, label: AI_FIELD_LABELS[key as AiFieldKey], value: String(value) })),
    warnings,
    createdAt: now,
    substitutions,
  };
}

export class ExternalAiDisabledError extends Error {
  constructor() {
    super('外部AIは設定でオフになっています');
  }
}

export const PREVIEW_TTL_MS = 5 * 60_000;

/**
 * Called only from the "この1回だけ許可" button. Re-hashes the request to make sure what is sent is
 * byte-identical to what was shown, then obtains a single-use consent and sends.
 */
export async function approveAndSend(opts: { session: VaultSession; api: ApiClient; enabled: boolean; preview: ExternalPreview; now?: number }): Promise<DraftResult> {
  const { session, api, preview } = opts;
  if (!opts.enabled) throw new ExternalAiDisabledError();
  if ((opts.now ?? Date.now()) - preview.createdAt > PREVIEW_TTL_MS) throw new Error('確認から時間が経ちました。もう一度内容を確認してください。');
  if ((await requestHash(preview.request)) !== preview.hash || canonicalJson(preview.request) !== preview.json) throw new Error('確認した内容と送信内容が一致しません');
  await session.audit('ai.external_approved', preview.request.subjectCount);
  try {
    const { consentId } = await api.createConsent(preview.hash, preview.request.destination);
    const { draft } = await api.draft(consentId, preview.request);
    await session.audit('ai.external_sent', preview.request.subjectCount);
    return restorePlaceholders(draft, preview.substitutions);
  } catch (e) {
    await session.audit('ai.external_failed', 1, 'failure');
    throw e;
  }
}
