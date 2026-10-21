// iPhone ↔ PC E2EE sync over real HTTP against the real server code (in-process, SQLite in memory).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toBase64 } from '@/core/crypto/bytes';
import { SyncHttpError } from '@/core/sync/protocol';
import { makeDevice, signIn } from '../helpers/device';
import { startTestServer, type TestServer } from '../helpers/server';

const EMAIL = 'kakuu.user@example.test';
const PII = ['架空 花子', 'かくう はなこ', 'hanako.kakuu@example.test', '090-0000-1234', 'テスト商事株式会社', '展示会での会話内容（架空）'];

let server: TestServer;
beforeEach(async () => {
  server = await startTestServer();
});
afterEach(async () => {
  await server.close();
});

async function addContact(device: Awaited<ReturnType<typeof makeDevice>>) {
  const s = device.session;
  const contact = s.build('contact', { fullName: '架空 花子', fullNameKana: 'かくう はなこ', emails: ['hanako.kakuu@example.test'], phones: [{ kind: 'mobile', value: '090-0000-1234' }], tags: ['展示会'], status: 'confirmed' });
  const org = s.build('organization', { name: 'テスト商事株式会社' });
  const aff = s.build('affiliation', { contactId: contact.id, organizationId: org.id, title: '営業部長', current: true });
  const imageId = await s.putImage(new TextEncoder().encode('FAKE-JPEG-架空 花子'));
  const card = s.build('card', { contactId: contact.id, frontBlobId: imageId, fields: [], ocrEngine: 'manual', status: 'confirmed' });
  const enc = s.build('encounter', { contactId: contact.id, date: '2026-10-01', event: '架空EXPO 2026', conversation: '展示会での会話内容（架空）', certainty: 'confirmed' });
  await s.commit([contact, org, aff, card, enc]);
  return { contact, imageId };
}

describe('cross-device E2EE sync', () => {
  it('iPhone registers → PC restores with recovery key → PC edits → iPhone sees the edit', async () => {
    const phone = await makeDevice(server, EMAIL, 'iPhone');
    const { contact, imageId } = await addContact(phone);
    const r1 = await phone.engine.sync();
    expect(r1.pushed, '5件のレコードが送信されていない。直し方: SyncEngine.push の dirty 判定を確認する').toBe(5);
    expect(r1.blobsUploaded).toBe(1);

    const pc = await makeDevice(server, EMAIL, 'PC Chrome', phone.recoveryKey);
    await pc.engine.sync();
    expect(pc.session.get(contact.id, 'contact')?.fullName).toBe('架空 花子');
    const image = await pc.session.getImage(imageId, (id) => pc.api.getBlob(id));
    expect(new TextDecoder().decode(image!)).toBe('FAKE-JPEG-架空 花子');

    const edited = { ...pc.session.get(contact.id, 'contact')!, tags: ['展示会', '要フォロー'] };
    await pc.session.commit([edited]);
    await pc.engine.sync();
    await phone.engine.sync();
    expect(phone.session.get(contact.id, 'contact')?.tags, 'PCの編集がiPhoneに反映されない。直し方: pull の revision 比較を確認する').toEqual(['展示会', '要フォロー']);
  });

  it('SEC-06: the server database holds no plaintext PII, recovery key or VMK', async () => {
    const phone = await makeDevice(server, EMAIL, 'iPhone');
    await addContact(phone);
    await phone.engine.sync();
    const dump: string[] = [];
    for (const { name } of server.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]) {
      for (const row of server.db.prepare(`SELECT * FROM ${name}`).all() as Record<string, unknown>[]) {
        for (const v of Object.values(row)) dump.push(v instanceof Uint8Array ? Buffer.from(v).toString('latin1') + Buffer.from(v).toString('utf8') : String(v));
      }
    }
    const all = dump.join('\n');
    for (const secret of [...PII, EMAIL, phone.recoveryKey]) {
      expect(all.includes(secret), `サーバーDBに平文「${secret}」が見つかった。直し方: 同期APIに送る値を暗号文のみにする`).toBe(false);
    }
    const logs = server.logs.join('\n');
    for (const secret of [...PII, EMAIL]) expect(logs.includes(secret), `サーバーログに「${secret}」が出力された。直し方: ログに本文・メールを出さない`).toBe(false);
  });

  it('SEC-07: another account cannot read or overwrite the first account’s objects or blobs', async () => {
    const phone = await makeDevice(server, EMAIL, 'iPhone');
    const { contact, imageId } = await addContact(phone);
    await phone.engine.sync();
    const intruder = await signIn(server, 'intruder@example.test', 'attacker');
    const page = await intruder.api.pull(0, 500);
    expect(page.changes, '別アカウントに暗号文が見えた。直し方: pull の WHERE account_id を確認する').toHaveLength(0);
    expect(await intruder.api.getBlob(imageId)).toBeNull();
    // Writing to the same object id only creates an object in the intruder's own namespace.
    await intruder.api.push({ deviceId: intruder.deviceId, changes: [{ objectId: contact.id, baseRevision: null, deleted: true, envelope: null }] });
    await phone.engine.sync();
    expect(phone.session.get(contact.id, 'contact')).toBeDefined();
    // A push claiming someone else's device id is rejected.
    await expect(intruder.api.push({ deviceId: phone.deviceId, changes: [] })).rejects.toMatchObject({ status: 403 });
  });

  it('SEC-08: signing in on a new device without the recovery key does not decrypt anything', async () => {
    const phone = await makeDevice(server, EMAIL, 'iPhone');
    await addContact(phone);
    await phone.engine.sync();
    const other = await makeDevice(server, 'someone@example.test', 'pc'); // own vault
    const stolen = await signIn(server, EMAIL, 'unknown device');
    const page = await stolen.api.pull(0, 500);
    expect(page.changes.length).toBeGreaterThan(0);
    for (const c of page.changes) {
      await expect(other.session.decryptEnvelope(c.objectId, Uint8Array.from(Buffer.from(c.envelope!, 'base64')))).rejects.toThrow();
    }
  });

  it('SEC-16: offline edits on both devices produce a conflict; keep_both preserves both versions', async () => {
    const phone = await makeDevice(server, EMAIL, 'iPhone');
    const { contact } = await addContact(phone);
    await phone.engine.sync();
    const pc = await makeDevice(server, EMAIL, 'PC', phone.recoveryKey);
    await pc.engine.sync();

    await phone.session.commit([{ ...phone.session.get(contact.id, 'contact')!, note: 'iPhoneでのメモ' }]);
    await pc.session.commit([{ ...pc.session.get(contact.id, 'contact')!, note: 'PCでのメモ' }]);
    await phone.engine.sync();
    const report = await pc.engine.sync();
    expect(report.conflicts, '競合が検出されない（無言の上書き）。直し方: push の baseRevision 比較を確認する').toBe(1);
    expect(pc.session.get(contact.id, 'contact')?.note, '競合時にローカル編集が失われた').toBe('PCでのメモ');

    await pc.engine.resolveConflict(contact.id, 'keep_both');
    await pc.engine.sync();
    await phone.engine.sync();
    const notes = phone.session.all('contact').map((c) => c.note).sort();
    expect(notes, '両方残すの結果が両端末に反映されない').toEqual(['PCでのメモ', 'iPhoneでのメモ']);
  });

  it('keep_local after a conflict is accepted by the other device (no false rollback alarm)', async () => {
    const phone = await makeDevice(server, EMAIL, 'iPhone');
    const { contact } = await addContact(phone);
    await phone.engine.sync();
    const pc = await makeDevice(server, EMAIL, 'PC', phone.recoveryKey);
    await pc.engine.sync();
    for (let i = 0; i < 3; i++) await phone.session.commit([{ ...phone.session.get(contact.id, 'contact')!, note: `phone ${i}` }]);
    await pc.session.commit([{ ...pc.session.get(contact.id, 'contact')!, note: 'pc wins' }]);
    await phone.engine.sync();
    await pc.engine.sync();
    await pc.engine.resolveConflict(contact.id, 'keep_local');
    await pc.engine.sync();
    const r = await phone.engine.sync();
    expect(r.rejected).toBe(0);
    expect(phone.session.get(contact.id, 'contact')?.note).toBe('pc wins');
  });

  it('deletions propagate as tombstones', async () => {
    const phone = await makeDevice(server, EMAIL, 'iPhone');
    const { contact } = await addContact(phone);
    await phone.engine.sync();
    const pc = await makeDevice(server, EMAIL, 'PC', phone.recoveryKey);
    await pc.engine.sync();
    await pc.session.remove([contact.id]);
    await pc.engine.sync();
    await phone.engine.sync();
    expect(phone.session.get(contact.id, 'contact')).toBeUndefined();
  });

  it('SEC-04: server-side tampering and replay of an older version are rejected, not applied', async () => {
    const phone = await makeDevice(server, EMAIL, 'iPhone');
    const { contact } = await addContact(phone);
    await phone.engine.sync();
    const pc = await makeDevice(server, EMAIL, 'PC', phone.recoveryKey);
    await pc.engine.sync();
    const old = server.db.prepare('SELECT envelope FROM objects WHERE object_id = ?').get(contact.id) as { envelope: string };
    await phone.session.commit([{ ...phone.session.get(contact.id, 'contact')!, note: 'v2' }]);
    await phone.engine.sync();
    await pc.engine.sync();
    // Malicious server: re-serve the old ciphertext as a newer revision.
    server.db.prepare('UPDATE objects SET envelope = ?, revision = revision + 1, seq = seq + 100 WHERE object_id = ?').run(old.envelope, contact.id);
    const r = await pc.engine.sync();
    expect(r.rejected, '古い暗号文の再送が受理された。直し方: pull で entity.version < maxVersion を拒否する').toBe(1);
    expect(pc.session.get(contact.id, 'contact')?.note).toBe('v2');
    // Bit flip
    const tampered = Buffer.from(old.envelope, 'base64');
    tampered[tampered.length - 1]! ^= 1;
    server.db.prepare('UPDATE objects SET envelope = ?, revision = revision + 1, seq = seq + 100 WHERE object_id = ?').run(toBase64(tampered), contact.id);
    expect((await pc.engine.sync()).rejected).toBe(1);
  });

  it('offline: sync failure keeps local edits and reports "offline"', async () => {
    const phone = await makeDevice(server, EMAIL, 'iPhone');
    const { contact } = await addContact(phone);
    await server.close();
    await phone.session.commit([{ ...phone.session.get(contact.id, 'contact')!, note: 'オフライン編集' }]);
    await expect(phone.engine.sync()).rejects.toBeInstanceOf(SyncHttpError);
    expect(phone.session.get(contact.id, 'contact')?.note).toBe('オフライン編集');
    expect(phone.session.pendingCount).toBeGreaterThan(0);
    server = await startTestServer(); // for afterEach
  });
});
