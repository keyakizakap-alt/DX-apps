// Follow-up suggestions computed only from recorded encounters and tasks. Each suggestion cites
// the source records; nothing is invented (no fabricated contact history).
import type { ContactView, EntityIndex } from './views';

export interface FollowUpSuggestion {
  contactId: string;
  priority: number;
  reason: string;
  sourceIds: string[];
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export function suggestFollowUps(index: EntityIndex, today: string, max = 10): FollowUpSuggestion[] {
  const out: FollowUpSuggestion[] = [];
  for (const view of index.views.values()) {
    const s = suggestionFor(view, today);
    if (s) out.push(s);
  }
  return out.sort((a, b) => b.priority - a.priority).slice(0, max);
}

function suggestionFor(view: ContactView, today: string): FollowUpSuggestion | undefined {
  const openTasks = view.tasks.filter((t) => !t.done);
  const overdue = openTasks.filter((t) => t.dueDate && t.dueDate <= today);
  if (overdue.length > 0) {
    return { contactId: view.contact.id, priority: 100 + overdue.length, reason: `期限を過ぎたフォロー予定が${overdue.length}件あります`, sourceIds: overdue.map((t) => t.id) };
  }
  const latest = view.encounters[0];
  if (!latest) return undefined;
  const age = daysBetween(latest.date, today);
  if (latest.nextAction && age >= 0 && age <= 60 && openTasks.length === 0) {
    return { contactId: view.contact.id, priority: 80 - age, reason: `${latest.date}の出会いメモに「次の行動」が記録されています`, sourceIds: [latest.id] };
  }
  if (age >= 0 && age <= 14 && openTasks.length === 0) {
    return { contactId: view.contact.id, priority: 50 - age, reason: `${age}日前に会ってからフォロー予定が未登録です`, sourceIds: [latest.id] };
  }
  if (openTasks.length > 0) {
    return { contactId: view.contact.id, priority: 30, reason: `未完了のフォロー予定が${openTasks.length}件あります`, sourceIds: openTasks.map((t) => t.id) };
  }
  return undefined;
}
