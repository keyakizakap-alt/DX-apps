// IndexedDB store against fake-indexeddb: atomic batches, persistence across reopen, and that
// nothing readable is stored (SEC-03 for the web).
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createVault } from '@/core/crypto/vault';
import { createWebCryptoProvider } from '@/core/crypto/webcrypto';
import { loadDemoData } from '@/core/demo/fixtures';
import { VaultSession } from '@/core/store/session';
import { openIndexedDbStore } from '@/platform/indexeddb-store';

describe('IndexedDB encrypted store', () => {
  it('persists across reopen and stores only ciphertext', async () => {
    const provider = createWebCryptoProvider();
    const created = await createVault(provider);
    const store = await openIndexedDbStore(indexedDB, 'test-db-1');
    const s1 = new VaultSession({ provider, store });
    await s1.open(created.keys);
    await loadDemoData(s1);
    const imageId = await s1.putImage(new TextEncoder().encode('架空 花子 の名刺画像'));
    s1.lock();

    const reopened = await openIndexedDbStore(indexedDB, 'test-db-1');
    const raw = JSON.stringify(await reopened.listRecords(), (_k, v) => (v instanceof Uint8Array ? new TextDecoder('latin1').decode(v) : v));
    expect(raw.includes('架空'), 'IndexedDBに平文の氏名が保存された').toBe(false);
    expect(raw.includes('hanako.kakuu')).toBe(false);
    const blob = await reopened.getBlob(imageId);
    expect(new TextDecoder().decode(blob!.envelope).includes('架空')).toBe(false);

    const s2 = new VaultSession({ provider, store: reopened });
    const report = await s2.open(created.keys);
    expect(report.unreadable).toBe(0);
    expect(s2.all('contact').length).toBeGreaterThan(5);
    expect(new TextDecoder().decode((await s2.getImage(imageId))!)).toBe('架空 花子 の名刺画像');
  });

  it('a locked session exposes nothing and refuses writes', async () => {
    const provider = createWebCryptoProvider();
    const store = await openIndexedDbStore(indexedDB, 'test-db-2');
    const s = new VaultSession({ provider, store });
    await s.open((await createVault(provider)).keys);
    await loadDemoData(s);
    s.lock();
    expect(s.all('contact')).toHaveLength(0);
    await expect(s.putImage(new Uint8Array([1]))).rejects.toThrow('ロック');
  });
});
