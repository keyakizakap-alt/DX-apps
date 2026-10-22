// Storage-level guarantees that must hold on both engines (SQLite and PostgreSQL/Neon), including
// under concurrent requests — on Vercel several function instances may serve one account at once.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dumpAllRows } from '../../server/sql.mts';
import { signIn } from '../helpers/device';
import { TEST_DIALECT, startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;
beforeEach(async () => {
  server = await startTestServer();
});
afterEach(async () => server.close());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${server.baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-meishi-client': 'native', ...headers }, body: JSON.stringify(body) });
const id = (n: number) => `c_${n.toString(16).padStart(24, '0')}`;
const ENV = Buffer.from('ciphertext-placeholder').toString('base64');

describe(`storage on ${TEST_DIALECT}`, () => {
  it('an OTP can be used only once, even by concurrent verify requests', async () => {
    const { challengeId } = await (await post('/api/auth/start', { email: 'race@example.test' })).json();
    const code = server.otps.get('race@example.test');
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => post('/api/auth/verify', { challengeId, code, deviceLabel: `d${i}` })));
    const ok = results.filter((r) => r.status === 200).length;
    expect(ok, `同じ確認コードで ${ok} 回サインインできた。直し方: consumed=0 を条件にした UPDATE の影響行数で1回だけ成功させる`).toBe(1);
  });

  it('concurrent first sign-ins for one address create exactly one account', async () => {
    // Issue challenges one by one (the fake mailer keeps only the latest code per address).
    const pairs: { challengeId: string; code: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const { challengeId } = await (await post('/api/auth/start', { email: `twin@example.test` })).json();
      pairs.push({ challengeId, code: server.otps.get('twin@example.test')! });
    }
    const verified = await Promise.all(pairs.map((p, i) => post('/api/auth/verify', { ...p, deviceLabel: `t${i}` }).then((r) => r.json())));
    const accounts = new Set(verified.map((v: { accountId: string }) => v.accountId));
    expect(accounts.size, `同じメールに ${accounts.size} 個のアカウントができた。直し方: email_hmac の一意制約と ON CONFLICT DO NOTHING の後に SELECT する`).toBe(1);
  });

  it('concurrent pushes of a new object from two devices: one wins, the other gets a conflict', async () => {
    const a = await signIn(server, 'push@example.test', 'iPhone');
    const b = await signIn(server, 'push@example.test', 'PC');
    const change = { objectId: id(1), baseRevision: null, deleted: false, envelope: ENV };
    const [ra, rb] = await Promise.all([
      a.api.push({ deviceId: a.deviceId, changes: [change] }),
      b.api.push({ deviceId: b.deviceId, changes: [change] }),
    ]);
    const statuses = [ra[0]!.status, rb[0]!.status].sort();
    expect(statuses, `同時pushの結果が ${statuses.join(',')} だった（片方が無言で上書き）。直し方: push の先頭で accounts 行をロックし、revision を確認する`).toEqual(['conflict', 'ok']);
  });

  it('seq numbers stay unique and increasing across concurrent pushes', async () => {
    const a = await signIn(server, 'seq@example.test', 'iPhone');
    const b = await signIn(server, 'seq@example.test', 'PC');
    const batch = (dev: typeof a, base: number) => dev.api.push({ deviceId: dev.deviceId, changes: Array.from({ length: 20 }, (_, i) => ({ objectId: id(base + i), baseRevision: null, deleted: false, envelope: ENV })) });
    const [ra, rb] = await Promise.all([batch(a, 100), batch(b, 200)]);
    const seqs = [...ra, ...rb].map((r) => (r.status === 'ok' ? r.seq : -1));
    expect(new Set(seqs).size, '同期番号(seq)が重複した。直し方: seq の採番を同じトランザクション内の UPDATE … RETURNING で行う').toBe(40);
  });

  it('a second, different vault can never replace the registered one (atomic upsert)', async () => {
    const a = await signIn(server, 'vault@example.test', 'iPhone');
    const env = (vaultId: string) => ({ format: 'meishi-recovery-envelope/v1' as const, vaultId, keyVersion: 1, envelope: ENV });
    const first = `v_${'a'.repeat(32)}`;
    const results = await Promise.allSettled([a.api.putRecoveryEnvelope(env(first)), a.api.putRecoveryEnvelope(env(`v_${'b'.repeat(32)}`))]);
    const stored = await a.api.getRecoveryEnvelope();
    expect(results.filter((r) => r.status === 'fulfilled').length, '別の保管庫による上書きが成功した。直し方: ON CONFLICT … DO UPDATE に WHERE vault_id = excluded.vault_id を付ける').toBe(1);
    await expect(a.api.putRecoveryEnvelope(env(stored!.vaultId === first ? `v_${'b'.repeat(32)}` : first))).rejects.toMatchObject({ status: 409 });
    await a.api.putRecoveryEnvelope({ ...env(stored!.vaultId), keyVersion: 2 }); // same vault: allowed (key rotation)
    expect((await a.api.getRecoveryEnvelope())!.keyVersion).toBe(2);
  });

  it('account deletion cascades to every table', async () => {
    const a = await signIn(server, 'gone@example.test', 'iPhone');
    await a.api.push({ deviceId: a.deviceId, changes: [{ objectId: id(9), baseRevision: null, deleted: false, envelope: ENV }] });
    const blob = new Uint8Array(40);
    blob[0] = 1;
    blob[1] = 2;
    await a.api.putBlob(`b_${'9'.repeat(24)}`, blob);
    await a.api.deleteAccount();
    const left = (await dumpAllRows(server.sql)).filter(({ table, row }) => table !== 'schema_migrations' && table !== 'otp_challenges' && JSON.stringify(row).includes(a.accountId));
    expect(left.map((l) => l.table), 'アカウント削除後に行が残った。直し方: 外部キーに ON DELETE CASCADE を付け、SQLite では PRAGMA foreign_keys=ON にする').toEqual([]);
    expect((await dumpAllRows(server.sql)).filter(({ table }) => table === 'blobs' || table === 'objects' || table === 'devices' || table === 'sessions').length).toBe(0);
  });

  it('BIGINT values (ms timestamps, seq) come back as numbers on both engines', async () => {
    const a = await signIn(server, 'types@example.test', 'iPhone');
    const row = await server.sql.get<{ expires_at: unknown; created_at: unknown }>('SELECT expires_at, created_at FROM sessions WHERE account_id = ?', a.accountId);
    expect(typeof row?.expires_at, 'BIGINT が数値以外で返った。直し方: pg の型パーサー（OID 20）で Number に変換する').toBe('number');
    expect(typeof row?.created_at).toBe('number');
  });
});

describe('client IP behind a trusted proxy', () => {
  it('rate-limits by the configured proxy header, not by the shared proxy socket address', async () => {
    await server.close();
    server = await startTestServer({ clientIpHeader: 'x-real-ip' });
    const start = (ip: string) => post('/api/auth/start', { email: `ip${Math.random()}@example.test` }, { 'x-real-ip': ip });
    const first = await Promise.all(Array.from({ length: 11 }, () => start('203.0.113.7')));
    expect(first.some((r) => r.status === 429), '同じクライアントIPの11回目が制限されなかった').toBe(true);
    expect((await start('203.0.113.8')).status, '別のクライアントIPまで制限された。直し方: clientIpHeader の値で利用者を区別する').toBe(200);
  });
});
