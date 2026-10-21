// Single constrained orchestrator for S11. Interprets the user's request, calls only
// PolicyGateway tools, and returns results with sources. It never writes data and never sends.
import type { Encounter } from '../domain/schemas';
import type { ContactView } from '../domain/views';
import type { VaultSession } from '../store/session';
import { PolicyGateway, type ContactBrief, type ToolResult } from './gateway';
import { interpretRequest, type AssistantIntent } from './intent';

export interface AssistantAnswer {
  intent: AssistantIntent['kind'];
  processing: 'local';
  message: string;
  explanation: string[];
  result?: ToolResult;
  draft?: LocalDraft;
  candidates?: ContactBrief[];
}

export interface LocalDraft {
  contactId: string;
  subject: string;
  body: string;
  sources: Array<{ id: string; label: string }>;
  assumptions: string[];
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function askAssistant(session: VaultSession, text: string, today: Date): Promise<AssistantAnswer> {
  const gateway = new PolicyGateway(session);
  const intent = interpretRequest(text, today);
  const base = { intent: intent.kind, processing: 'local' as const, explanation: intent.explanation };
  switch (intent.kind) {
    case 'unsupported':
      return { ...base, message: '質問を解釈できませんでした。' };
    case 'search': {
      const result = await gateway.invoke({ tool: 'searchContacts', args: { filters: intent.filters }, origin: 'user' });
      const n = result.ok && result.tool === 'searchContacts' ? result.total : 0;
      return { ...base, result, message: n ? `${n}件見つかりました（端末内で検索）` : '該当する人物は見つかりませんでした。条件を減らしてください。' };
    }
    case 'followups': {
      const result = await gateway.invoke({ tool: 'suggestFollowUps', args: { today: ymd(today) }, origin: 'user' });
      const n = result.ok && result.tool === 'suggestFollowUps' ? result.items.length : 0;
      return { ...base, result, message: n ? `フォロー候補 ${n}件（記録された出会い・予定のみが根拠です）` : 'フォロー候補はありません。' };
    }
    case 'duplicates': {
      const result = await gateway.invoke({ tool: 'findDuplicates', args: {}, origin: 'user' });
      const n = result.ok && result.tool === 'findDuplicates' ? result.items.length : 0;
      return { ...base, result, message: n ? `重複候補 ${n}組。統合は「重複候補」画面で人が判断してください。` : '重複候補はありません。' };
    }
    case 'draft':
    case 'summarize': {
      const found = await gateway.invoke({ tool: 'searchContacts', args: { filters: { text: intent.target } }, origin: 'user' });
      const items = found.ok && found.tool === 'searchContacts' ? found.items : [];
      if (items.length !== 1) {
        return { ...base, candidates: items.slice(0, 5), message: items.length ? `「${intent.target}」に該当する人が${items.length}人います。人物を選んでください。` : `「${intent.target}」に該当する人が見つかりません。` };
      }
      const view = session.index.views.get(items[0]!.id)!;
      if (intent.kind === 'draft') return { ...base, draft: localDraft(view), message: '端末内のテンプレートで下書きしました。内容を確認してからコピーしてください（送信機能はありません）。' };
      const summary = await gateway.invoke({ tool: 'getContactSummary', args: { ids: [view.contact.id] }, origin: 'user' });
      return { ...base, result: summary, message: view.encounters.length ? `${view.contact.fullName}さんとの出会い記録 ${view.encounters.length}件` : '出会いの記録がありません。' };
    }
  }
}

/** Deterministic, on-device template. Uses only recorded facts and lists what it assumed. */
export function localDraft(view: ContactView, encounter: Encounter | undefined = view.encounters[0]): LocalDraft {
  const c = view.contact;
  const org = view.current?.organization?.name;
  const sources: LocalDraft['sources'] = [{ id: c.id, label: '人物情報' }];
  const assumptions: string[] = [];
  const lines = [`${org ? `${org}\n` : ''}${c.fullName} 様`, '', 'お世話になっております。'];
  if (encounter) {
    sources.push({ id: encounter.id, label: `出会いメモ（${encounter.date}）` });
    lines.push(`${encounter.event ? `${encounter.event}` : `${encounter.date}`}ではお時間をいただき、ありがとうございました。`);
    if (encounter.conversation) lines.push(`お話しした「${encounter.conversation.slice(0, 60)}${encounter.conversation.length > 60 ? '…' : ''}」の件、大変参考になりました。`);
    if (encounter.nextAction) lines.push(`ご相談いただいた次のステップ（${encounter.nextAction}）について、改めてご連絡いたします。`);
  } else {
    assumptions.push('出会いの記録がないため、具体的な経緯は書いていません。');
  }
  lines.push('', '今後ともどうぞよろしくお願いいたします。', '', '（署名）');
  assumptions.push('署名・日程などは手で補ってください。');
  return { contactId: c.id, subject: encounter?.event ? `${encounter.event}のお礼` : 'ご挨拶のお礼', body: lines.join('\n'), sources, assumptions };
}
