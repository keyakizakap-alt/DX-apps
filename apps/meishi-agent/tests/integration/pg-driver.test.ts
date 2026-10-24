// The production driver path (node-postgres Pool → PostgreSQL wire protocol), exercised against
// PGlite behind a local socket server. Covers what PGlite-in-process cannot: pg's type parsing,
// pooled connections and BEGIN/COMMIT on a checked-out client.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app.mts';
import { openPostgres } from '../../server/pg.mts';
import { nodePgConnection } from '../../server/pg-node.mts';
import type { Sql } from '../../server/sql.mts';
import { makeDevice } from '../helpers/device';
import type { TestServer } from '../helpers/server';

let db: PGlite;
let socket: PGLiteSocketServer;
let http: Server;
let sql: Sql;
const server = { baseUrl: '', otps: new Map<string, string>(), logs: [] as string[] } as unknown as TestServer;

beforeAll(async () => {
  db = new PGlite();
  socket = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
  await socket.start();
  sql = openPostgres(nodePgConnection(`postgres://postgres:postgres@${socket.getServerConn()}/postgres?sslmode=disable`).conn);
  const handler = createApp({
    sql,
    secret: 'test-secret-test-secret-test-secret-0123',
    mailer: { sendOtp: async (email, code) => void server.otps.set(email, code) },
    secureCookies: false,
    allowedOrigins: ['http://localhost'],
    log: () => {},
  });
  http = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  (server as { baseUrl: string }).baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => http.close(() => r()));
  await sql.close();
  await socket.stop();
  await db.close();
});

describe('node-postgres driver against PostgreSQL', () => {
  it('migrates, signs in, syncs ciphertext between two devices and round-trips an encrypted image', async () => {
    const phone = await makeDevice(server, 'pg@example.test', 'iPhone');
    const contact = phone.session.build('contact', { fullName: '架空 次郎', emails: [], phones: [], tags: [], status: 'confirmed' });
    const imageId = await phone.session.putImage(new TextEncoder().encode('FAKE-JPEG'));
    const card = phone.session.build('card', { contactId: contact.id, frontBlobId: imageId, fields: [], ocrEngine: 'manual', status: 'confirmed' });
    await phone.session.commit([contact, card]);
    await phone.engine.sync();
    const pc = await makeDevice(server, 'pg@example.test', 'PC', phone.recoveryKey);
    await pc.engine.sync();
    expect(pc.session.get(contact.id, 'contact')?.fullName, 'pg ドライバー経由で同期できなかった').toBe('架空 次郎');
    expect(new TextDecoder().decode((await pc.session.getImage(imageId, (id) => pc.api.getBlob(id)))!), 'BYTEA の往復で画像が壊れた').toBe('FAKE-JPEG');
  });

  it('returns BIGINT columns as numbers through pg type parsers', async () => {
    const row = await sql.get<{ seq: unknown; n: unknown }>('SELECT seq, (SELECT COUNT(*) FROM objects) AS n FROM accounts LIMIT 1');
    expect(typeof row?.seq, 'pg が BIGINT を文字列で返した。直し方: Pool の types.getTypeParser で OID 20 を Number にする').toBe('number');
    expect(typeof row?.n).toBe('number');
  });

  it('rolls back a failed transaction on a pooled client', async () => {
    await expect(sql.tx(async (q) => {
      await q.run("UPDATE accounts SET created_at = 'x'");
      throw new Error('boom');
    })).rejects.toThrow('boom');
    const left = await sql.all("SELECT 1 AS x FROM accounts WHERE created_at = 'x'");
    expect(left, 'トランザクションが巻き戻らなかった').toEqual([]);
  });
});
