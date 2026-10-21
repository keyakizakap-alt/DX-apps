// S04–S07: 50-card import session, resume after interruption, per-row retry, review → person,
// job change keeps history, and export rules (S15).
import { describe, expect, it } from 'vitest';
import { createVault } from '@/core/crypto/vault';
import { createWebCryptoProvider } from '@/core/crypto/webcrypto';
import { DEMO_OCR_TEXTS, loadDemoData } from '@/core/demo/fixtures';
import { contactsToCsv, createEncryptedBackup, restoreEncryptedBackup, verifyRecoveryKey } from '@/core/export';
import { activeItems, enqueueImages, MAX_SESSION_ITEMS, QueueFullError, recoverInterrupted, retryItem, runQueue } from '@/core/scan/queue';
import { initialFields, saveReviewedCard, ReviewValidationError } from '@/core/scan/review';
import type { OcrEngine } from '@/core/scan/ocr';
import { createMemoryStore } from '@/core/store/memory-store';
import { VaultSession } from '@/core/store/session';

async function setup() {
  const provider = createWebCryptoProvider();
  const store = createMemoryStore();
  const created = await createVault(provider);
  const session = new VaultSession({ provider, store });
  await session.open(created.keys);
  return { provider, store, session, created };
}

const img = (n: number) => new TextEncoder().encode(`fake-card-image-${n}`);

function fakeOcr(opts: { failOn?: Set<number>; lines?: string[] } = {}): OcrEngine & { calls: number } {
  const engine = {
    id: 'tesseract-jpn' as const,
    label: 'fake',
    calls: 0,
    available: async () => true,
    async recognize(jpeg: Uint8Array) {
      engine.calls++;
      const n = Number(new TextDecoder().decode(jpeg).split('-').pop());
      if (opts.failOn?.has(n)) throw new Error('認識に失敗（テスト）');
      return (opts.lines ?? DEMO_OCR_TEXTS.horizontal!).map((text) => ({ text, confidence: 0.92 }));
    },
    dispose: async () => {},
  };
  return engine;
}

describe('import queue', () => {
  it('accepts 50 cards per session, rejects the 51st, and skips duplicate images', async () => {
    const { session } = await setup();
    const { items } = await enqueueImages(session, Array.from({ length: 30 }, (_, i) => ({ jpeg: img(i) })));
    expect(items).toHaveLength(30);
    const dup = await enqueueImages(session, [{ jpeg: img(0) }]);
    expect(dup.duplicates, '同じ画像が二重登録された').toBe(1);
    await expect(enqueueImages(session, Array.from({ length: 25 }, (_, i) => ({ jpeg: img(100 + i) })))).rejects.toBeInstanceOf(QueueFullError);
    expect(activeItems(session)).toHaveLength(MAX_SESSION_ITEMS);
  });

  it('survives a reload mid-recognition (encrypted queue) and resumes; failed rows retry individually', async () => {
    const { provider, store, session, created } = await setup();
    await enqueueImages(session, Array.from({ length: 5 }, (_, i) => ({ jpeg: img(i) })));
    // Simulate a crash while item 0 is recognizing.
    const first = activeItems(session)[0]!;
    await session.commit([{ ...first, status: 'recognizing' }]);
    session.lock();

    const reopened = new VaultSession({ provider, store });
    await reopened.open(created.keys);
    expect(await recoverInterrupted(reopened)).toBe(1);
    const ocr = fakeOcr({ failOn: new Set([3]) });
    expect(await runQueue(reopened, ocr).done).toBe(4);
    const items = activeItems(reopened);
    expect(items.filter((i) => i.status === 'needs_review')).toHaveLength(4);
    const failed = items.find((i) => i.status === 'failed')!;
    expect(failed.error).toContain('失敗');
    await retryItem(reopened, failed.id);
    expect(await runQueue(reopened, fakeOcr()).done, '失敗行だけ再試行できない').toBe(1);
  });

  it('a 50-card session completes end-to-end (OCR → review → people)', async () => {
    const { session } = await setup();
    await enqueueImages(session, Array.from({ length: 50 }, (_, i) => ({ jpeg: img(i) })));
    await runQueue(session, fakeOcr()).done;
    for (const [n, item] of activeItems(session).entries()) {
      const fields = initialFields(item).map((f) => (f.key === 'fullName' ? { ...f, value: `架空 ${n}号`, verified: true } : { ...f, verified: true }));
      await saveReviewedCard(session, { item, fields, decision: { kind: 'new_person' } });
    }
    expect(activeItems(session)).toHaveLength(0);
    expect(session.all('contact')).toHaveLength(50);
    expect(session.all('organization'), '同じ会社が50社に分裂した').toHaveLength(1);
  });
});

describe('review decisions', () => {
  it('requires name and company unless held', async () => {
    const { session } = await setup();
    await expect(saveReviewedCard(session, { fields: [{ key: 'fullName', value: '架空', source: 'user', verified: true }], decision: { kind: 'new_person' } })).rejects.toBeInstanceOf(ReviewValidationError);
    const held = await saveReviewedCard(session, { fields: [], decision: { kind: 'hold' } });
    expect(session.get(held.cardId, 'card')?.status).toBe('on_hold');
  });

  it('adding a card from a new employer keeps the old affiliation as history (転職)', async () => {
    const { session } = await setup();
    const ids = await loadDemoData(session);
    const before = session.index.views.get(ids.taro!)!;
    expect(before.current?.organization?.name).toBe('サンプル工業株式会社');
    await saveReviewedCard(session, {
      fields: [
        { key: 'fullName', value: '試験 太郎', source: 'user', verified: true },
        { key: 'company', value: 'モックシステムズ株式会社', source: 'user', verified: true },
        { key: 'title', value: 'テックリード', source: 'user', verified: true },
        { key: 'email', value: 'taro@mock-systems.example', source: 'user', verified: true },
      ],
      decision: { kind: 'same_person', contactId: ids.taro! },
    });
    const after = session.index.views.get(ids.taro!)!;
    expect(after.current?.organization?.name).toBe('モックシステムズ株式会社');
    expect(after.history.map((h) => h.organization?.name)).toContain('サンプル工業株式会社');
    expect(after.contact.emails).toEqual(['taro@sample-kogyo.example', 'taro@mock-systems.example']);
    expect(after.cards).toHaveLength(2);
  });

  it('"different person" records the decision so the pair is not suggested again', async () => {
    const { session } = await setup();
    const ids = await loadDemoData(session);
    const r = await saveReviewedCard(session, {
      fields: [
        { key: 'fullName', value: '山田 一郎', source: 'user', verified: true },
        { key: 'company', value: '別の架空株式会社', source: 'user', verified: true },
      ],
      decision: { kind: 'new_person' },
      dismissContactIds: [ids.yamada1!],
    });
    expect(session.all('duplicateDecision').some((d) => d.subjectIds.includes(r.contactId!) && d.decision === 'different')).toBe(true);
  });
});

describe('export (S15, SEC-13)', () => {
  it('CSV neutralises spreadsheet formulas and includes a BOM', async () => {
    const { session } = await setup();
    const ids = await loadDemoData(session);
    await session.commit([{ ...session.get(ids.hanako!, 'contact')!, tags: ['=CMD()'], note: undefined }]);
    const { csv, count } = contactsToCsv(session);
    expect(count).toBe(9);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`"'=CMD()"`);
  });
  it('plaintext export re-authentication: only the correct recovery key passes', async () => {
    const { session, created } = await setup();
    expect(await verifyRecoveryKey(session, created.recoveryEnvelope, created.recoveryKey)).toBe(true);
    const other = await createVault(session.provider);
    expect(await verifyRecoveryKey(session, created.recoveryEnvelope, other.recoveryKey)).toBe(false);
    expect(await verifyRecoveryKey(session, created.recoveryEnvelope, 'MK1-AAAAA')).toBe(false);
  });
  it('encrypted backup restores into an empty device of the same vault and contains no plaintext', async () => {
    const { session, created, provider } = await setup();
    await loadDemoData(session);
    const backup = await createEncryptedBackup(session, created.recoveryEnvelope, true);
    expect(JSON.stringify(backup)).not.toContain('架空');
    const fresh = new VaultSession({ provider, store: createMemoryStore() });
    await fresh.open(created.keys);
    const r = await restoreEncryptedBackup(fresh, backup);
    expect(r.restored).toBe(backup.records.length);
    expect(fresh.all('contact')).toHaveLength(9);
  });
});
