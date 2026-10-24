// On-device search over the decrypted in-memory index. Queries never leave the device.
import { normalizeCompany, normalizeText } from './normalize';
import type { ReviewStatus } from './schemas';
import type { ContactView, EntityIndex } from './views';

export interface SearchFilters {
  text?: string;
  tag?: string;
  status?: ReviewStatus;
  company?: string;
  event?: string;
  metFrom?: string; // YYYY-MM-DD inclusive
  metTo?: string; // YYYY-MM-DD inclusive
}

export interface SearchHit {
  view: ContactView;
  matched: string[]; // which fields matched, for "根拠" display
}

function haystack(view: ContactView): Record<string, string> {
  const c = view.contact;
  return {
    氏名: normalizeText(`${c.fullName} ${c.fullNameKana ?? ''}`),
    会社: view.history.map((h) => normalizeText(h.organization?.name) + normalizeCompany(h.organization?.name) + normalizeText(h.organization?.nameKana)).join(' '),
    部署役職: view.history.map((h) => normalizeText(`${h.affiliation.department ?? ''}${h.affiliation.title ?? ''}`)).join(' '),
    タグ: normalizeText(c.tags.join(' ')),
    メモ: normalizeText(`${c.note ?? ''} ${view.encounters.map((e) => `${e.conversation ?? ''} ${e.nextAction ?? ''}`).join(' ')}`),
    イベント: normalizeText(view.encounters.map((e) => `${e.event ?? ''} ${e.place ?? ''}`).join(' ')),
    連絡先: normalizeText(`${c.emails.join(' ')} ${c.phones.map((p) => p.value.replace(/\D/g, '')).join(' ')}`),
  };
}

export function searchContacts(index: EntityIndex, filters: SearchFilters, limit = 500): SearchHit[] {
  const terms = normalizeText(filters.text ?? '')
    ? (filters.text ?? '').split(/[\s　]+/).map(normalizeText).filter(Boolean)
    : [];
  const hits: SearchHit[] = [];
  for (const contact of index.contacts) {
    const view = index.views.get(contact.id);
    if (!view) continue;
    if (filters.status && contact.status !== filters.status) continue;
    if (filters.tag && !contact.tags.includes(filters.tag)) continue;
    if (filters.company) {
      const want = normalizeCompany(filters.company);
      if (!view.history.some((h) => normalizeCompany(h.organization?.name).includes(want))) continue;
    }
    if (filters.event) {
      const want = normalizeText(filters.event);
      if (!view.encounters.some((e) => normalizeText(e.event).includes(want))) continue;
    }
    if (filters.metFrom || filters.metTo) {
      const inRange = view.encounters.some((e) => (!filters.metFrom || e.date >= filters.metFrom) && (!filters.metTo || e.date <= filters.metTo));
      if (!inRange) continue;
    }
    const hay = haystack(view);
    const matched = new Set<string>();
    let ok = true;
    for (const term of terms) {
      const fields = Object.entries(hay).filter(([, v]) => v.includes(term));
      if (fields.length === 0) {
        ok = false;
        break;
      }
      fields.forEach(([k]) => matched.add(k));
    }
    if (!ok) continue;
    hits.push({ view, matched: [...matched] });
    if (hits.length >= limit) break;
  }
  return hits;
}
