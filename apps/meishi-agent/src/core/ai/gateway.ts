// PolicyGateway: the only path from the assistant to data. Enforced in code, not by prompt text.
// - fixed allowlist of read-only tools; destructive / outbound tools do not exist here
// - every call carries its origin; calls derived from card/memo content are always refused
// - per-tool argument schemas and result limits
import { z } from 'zod';
import { findDuplicateCandidates, pairKey, type DuplicateCandidate } from '../domain/duplicates';
import { suggestFollowUps, type FollowUpSuggestion } from '../domain/followup';
import { searchContacts, type SearchFilters } from '../domain/search';
import type { ContactView } from '../domain/views';
import type { VaultSession } from '../store/session';

export const ALLOWED_TOOLS = ['searchContacts', 'getContactSummary', 'suggestFollowUps', 'findDuplicates'] as const;
export type ToolName = (typeof ALLOWED_TOOLS)[number];

/** Names that must never be callable by the assistant (documented for tests and reviewers). */
export const FORBIDDEN_TOOLS = ['deleteContacts', 'mergeContacts', 'exportPlaintext', 'sendEmail', 'shareContact', 'sendToExternalAi', 'executeSql', 'fetchUrl', 'changePolicy'] as const;

export const LIMITS = { maxResults: 20, maxIds: 5, maxQueryChars: 300 } as const;

export type CallOrigin = 'user' | 'content';

export interface ToolCall {
  tool: string;
  args: unknown;
  origin: CallOrigin;
}

export interface ContactBrief {
  id: string;
  name: string;
  company?: string;
  title?: string;
  lastMetAt?: string;
  matched?: string[];
}

export type ToolResult =
  | { ok: true; tool: 'searchContacts'; items: ContactBrief[]; total: number }
  | { ok: true; tool: 'getContactSummary'; items: Array<ContactBrief & { encounters: Array<{ id: string; date: string; event?: string; conversation?: string; nextAction?: string }> }> }
  | { ok: true; tool: 'suggestFollowUps'; items: Array<FollowUpSuggestion & { brief: ContactBrief }> }
  | { ok: true; tool: 'findDuplicates'; items: Array<{ a: ContactBrief; b: ContactBrief; candidate: DuplicateCandidate }> }
  | { ok: false; reason: string };

const Filters = z
  .object({
    text: z.string().max(LIMITS.maxQueryChars).optional(),
    tag: z.string().max(30).optional(),
    status: z.enum(['needs_review', 'confirmed', 'on_hold']).optional(),
    company: z.string().max(120).optional(),
    event: z.string().max(120).optional(),
    metFrom: z.iso.date().optional(),
    metTo: z.iso.date().optional(),
  })
  .strict();

const ARGS = {
  searchContacts: z.object({ filters: Filters }).strict(),
  getContactSummary: z.object({ ids: z.array(z.string()).min(1).max(LIMITS.maxIds) }).strict(),
  suggestFollowUps: z.object({ today: z.iso.date() }).strict(),
  findDuplicates: z.object({}).strict(),
} satisfies Record<ToolName, z.ZodType>;

export function brief(view: ContactView, matched?: string[]): ContactBrief {
  return {
    id: view.contact.id,
    name: view.contact.fullName,
    company: view.current?.organization?.name,
    title: view.current?.affiliation.title,
    lastMetAt: view.lastMetAt,
    ...(matched ? { matched } : {}),
  };
}

export class PolicyGateway {
  constructor(private readonly session: VaultSession) {}

  async invoke(call: ToolCall): Promise<ToolResult> {
    const deny = async (reason: string): Promise<ToolResult> => {
      await this.session.audit('ai.policy_denied', 1, 'denied');
      return { ok: false, reason };
    };
    if (call.origin !== 'user') return deny('名刺・メモ由来の指示は実行しません');
    if (!(ALLOWED_TOOLS as readonly string[]).includes(call.tool)) return deny(`許可されていない操作です: ${call.tool}`);
    const tool = call.tool as ToolName;
    const parsed = ARGS[tool].safeParse(call.args);
    if (!parsed.success) return deny('引数が不正です');
    const index = this.session.index;
    await this.session.audit('ai.local_query');
    switch (tool) {
      case 'searchContacts': {
        const hits = searchContacts(index, (parsed.data as { filters: SearchFilters }).filters);
        return { ok: true, tool, total: hits.length, items: hits.slice(0, LIMITS.maxResults).map((h) => brief(h.view, h.matched)) };
      }
      case 'getContactSummary': {
        const ids = (parsed.data as { ids: string[] }).ids;
        const items = ids.flatMap((id) => {
          const v = index.views.get(id);
          return v ? [{ ...brief(v), encounters: v.encounters.slice(0, 10).map((e) => ({ id: e.id, date: e.date, event: e.event, conversation: e.conversation, nextAction: e.nextAction })) }] : [];
        });
        return { ok: true, tool, items };
      }
      case 'suggestFollowUps': {
        const items = suggestFollowUps(index, (parsed.data as { today: string }).today, LIMITS.maxResults).flatMap((s) => {
          const v = index.views.get(s.contactId);
          return v ? [{ ...s, brief: brief(v) }] : [];
        });
        return { ok: true, tool, items };
      }
      case 'findDuplicates': {
        const dismissed = new Set(this.session.all('duplicateDecision').filter((d) => d.decision !== 'later').map((d) => d.pairKey));
        const subjects = [...index.views.values()].map((v) => ({
          id: v.contact.id,
          fullName: v.contact.fullName,
          fullNameKana: v.contact.fullNameKana,
          company: v.current?.organization?.name,
          emails: v.contact.emails,
          phones: v.contact.phones.map((p) => p.value),
        }));
        const seen = new Set<string>();
        const items: Array<{ a: ContactBrief; b: ContactBrief; candidate: DuplicateCandidate }> = [];
        for (const s of subjects) {
          for (const c of findDuplicateCandidates(s, subjects, dismissed, s.id)) {
            const key = pairKey(s.id, c.subjectId);
            if (seen.has(key)) continue;
            seen.add(key);
            items.push({ a: brief(index.views.get(s.id)!), b: brief(index.views.get(c.subjectId)!), candidate: c });
          }
        }
        return { ok: true, tool, items: items.sort((x, y) => y.candidate.score - x.candidate.score).slice(0, LIMITS.maxResults) };
      }
    }
  }
}
