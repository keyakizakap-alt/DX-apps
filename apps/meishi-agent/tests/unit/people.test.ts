import { describe, expect, it } from 'vitest';
import { computeDuplicatePairs } from '@/core/ai/gateway';
import { createVault } from '@/core/crypto/vault';
import { createWebCryptoProvider } from '@/core/crypto/webcrypto';
import { loadDemoData } from '@/core/demo/fixtures';
import { decideDuplicate, deleteContact, mergeContacts } from '@/core/people';
import { createMemoryStore } from '@/core/store/memory-store';
import { VaultSession } from '@/core/store/session';

async function setup() {
  const provider = createWebCryptoProvider();
  const session = new VaultSession({ provider, store: createMemoryStore() });
  await session.open((await createVault(provider)).keys);
  return { session, ids: await loadDemoData(session) };
}

describe('user-driven people operations', () => {
  it('"different" removes the pair from candidates; nothing is merged', async () => {
    const { session, ids } = await setup();
    const before = computeDuplicatePairs(session).length;
    await decideDuplicate(session, ids.yamada1!, ids.yamada2!, 'different');
    expect(computeDuplicatePairs(session).length).toBe(before - 1);
    expect(session.all('contact')).toHaveLength(9);
  });
  it('explicit merge keeps history, encounters and both e-mails', async () => {
    const { session, ids } = await setup();
    await mergeContacts(session, ids.yamada1!, ids.yamada2!);
    const v = session.index.views.get(ids.yamada1!)!;
    expect(session.get(ids.yamada2!, 'contact')).toBeUndefined();
    expect(v.contact.emails).toEqual(['ichiro.yamada@dummy-bank.example', 'yamada@kakuu-u.example']);
    expect(v.history.filter((h) => h.affiliation.current)).toHaveLength(1);
    expect(v.history).toHaveLength(2);
    expect(v.cards).toHaveLength(2);
  });
  it('deleting a person removes attached records', async () => {
    const { session, ids } = await setup();
    await deleteContact(session, ids.hanako!);
    expect(session.all('encounter').some((e) => e.contactId === ids.hanako)).toBe(false);
    expect(session.all('card').some((e) => e.contactId === ids.hanako)).toBe(false);
  });
});
