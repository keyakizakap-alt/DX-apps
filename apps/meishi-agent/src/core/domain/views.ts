// Read models derived from decrypted entities held in memory while the vault is unlocked.
import type { Affiliation, BusinessCard, Contact, Encounter, Entity, FollowUpTask, Organization } from './schemas';

export interface AffiliationView {
  affiliation: Affiliation;
  organization?: Organization;
}

export interface ContactView {
  contact: Contact;
  current?: AffiliationView;
  history: AffiliationView[];
  cards: BusinessCard[];
  encounters: Encounter[];
  tasks: FollowUpTask[];
  lastMetAt?: string;
}

export interface EntityIndex {
  contacts: Contact[];
  byId: Map<string, Entity>;
  views: Map<string, ContactView>;
}

export function buildIndex(entities: Iterable<Entity>): EntityIndex {
  const byId = new Map<string, Entity>();
  const contacts: Contact[] = [];
  const views = new Map<string, ContactView>();
  const all = [...entities];
  for (const e of all) {
    byId.set(e.id, e);
    if (e.type === 'contact') {
      contacts.push(e);
      views.set(e.id, { contact: e, history: [], cards: [], encounters: [], tasks: [] });
    }
  }
  for (const e of all) {
    const view = 'contactId' in e && e.contactId ? views.get(e.contactId) : undefined;
    if (!view) continue;
    if (e.type === 'affiliation') {
      const org = byId.get(e.organizationId);
      view.history.push({ affiliation: e, organization: org?.type === 'organization' ? org : undefined });
    } else if (e.type === 'card') view.cards.push(e);
    else if (e.type === 'encounter') view.encounters.push(e);
    else if (e.type === 'followup') view.tasks.push(e);
  }
  for (const view of views.values()) {
    view.history.sort((a, b) => Number(b.affiliation.current) - Number(a.affiliation.current) || (b.affiliation.observedAt ?? b.affiliation.createdAt).localeCompare(a.affiliation.observedAt ?? a.affiliation.createdAt));
    view.current = view.history.find((h) => h.affiliation.current) ?? view.history[0];
    view.encounters.sort((a, b) => b.date.localeCompare(a.date));
    view.cards.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    view.lastMetAt = view.encounters[0]?.date;
  }
  contacts.sort((a, b) => a.fullName.localeCompare(b.fullName, 'ja'));
  return { contacts, byId, views };
}
