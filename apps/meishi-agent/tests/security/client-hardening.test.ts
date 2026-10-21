// Client-side hardening: passcode policy, tamper-evident audit chain, and robustness of every
// parser that touches untrusted bytes (fuzzed with random input).
import { describe, expect, it } from 'vitest';
import { readAudit, recordAudit, verifyAudit, type AuditEvent } from '@/core/audit';
import { fromBase64 } from '@/core/crypto/bytes';
import { open as openEnvelope, readHeader } from '@/core/crypto/envelope';
import { DecryptionError } from '@/core/crypto/provider';
import { openRecord } from '@/core/crypto/records';
import { parseRecoveryKey, RecoveryKeyFormatError } from '@/core/crypto/recovery-key';
import { createVault } from '@/core/crypto/vault';
import { createWebCryptoProvider } from '@/core/crypto/webcrypto';
import { parseCardText } from '@/core/domain/ocr-parse';
import { passcodeProblem } from '@/core/passcode-policy';
import { createMemoryStore } from '@/core/store/memory-store';
import { META } from '@/core/store/types';

const p = createWebCryptoProvider();
const rnd = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

describe('passcode policy', () => {
  it('refuses short, repeated, numeric-only, common and sequential passcodes', () => {
    for (const bad of ['short', 'aaaaaaaaaaaa', '1234567890', '98765432109', 'Password-2026', 'abcdefghijkl', 'meishikanri!']) expect(passcodeProblem(bad), bad).not.toBeNull();
    for (const ok of ['correct horse 2026', '架空の合言葉で解除する', '73919205118420']) expect(passcodeProblem(ok), ok).toBeNull();
  });
});

describe('audit hash chain', () => {
  it('verifies an intact log and detects an edited entry', async () => {
    const store = createMemoryStore();
    for (const a of ['vault.create', 'vault.unlock', 'record.create', 'export.csv'] as const) await recordAudit(store, a);
    expect(await verifyAudit(store)).toEqual({ ok: true });
    const list = (await store.getMeta<AuditEvent[]>(META.audit))!;
    list[2] = { ...list[2]!, action: 'vault.lock' }; // attacker hides a CSV export / edits history
    await store.setMeta(META.audit, list);
    expect(await verifyAudit(store), '監査ログの改ざんを検知できない').toEqual({ ok: false, brokenAt: 2 });
    expect((await readAudit(store)).length).toBe(4);
  });
  it('detects a deleted entry in the middle', async () => {
    const store = createMemoryStore();
    for (const a of ['vault.create', 'export.csv', 'record.delete'] as const) await recordAudit(store, a);
    const list = (await store.getMeta<AuditEvent[]>(META.audit))!;
    await store.setMeta(META.audit, [list[0], list[2]]);
    expect((await verifyAudit(store)).ok).toBe(false);
  });
});

describe('fuzzing untrusted input (no crash, only typed errors)', () => {
  it('random envelopes never decrypt and only raise DecryptionError', async () => {
    const created = await createVault(p);
    for (let i = 0; i < 300; i++) {
      const env = rnd(Math.floor(Math.random() * 120));
      if (i % 3 === 0 && env.length > 6) env[0] = 1; // look like v1 headers sometimes
      await expect(openRecord(p, created.keys, 'c_000000000000000000000001', env)).rejects.toBeInstanceOf(DecryptionError);
    }
  });
  it('envelope header reader rejects short input', () => {
    expect(() => readHeader(new Uint8Array(5))).toThrow(DecryptionError);
  });
  it('random recovery keys are rejected as format errors (checksum)', async () => {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let accepted = 0;
    for (let i = 0; i < 300; i++) {
      const body = Array.from({ length: 55 }, () => alphabet[Math.floor(Math.random() * 32)]).join('');
      try {
        await parseRecoveryKey(body, p.sha256);
        accepted++;
      } catch (e) {
        expect(e).toBeInstanceOf(RecoveryKeyFormatError);
      }
    }
    // 16-bit checksum + canonical padding: random strings pass with probability ~2^-18.
    expect(accepted).toBeLessThanOrEqual(1);
  });
  it('base64 decoder and OCR parser tolerate garbage', () => {
    for (let i = 0; i < 200; i++) {
      const s = String.fromCharCode(...rnd(40));
      try {
        fromBase64(s);
      } catch (e) {
        expect((e as Error).message).toBe('invalid base64');
      }
      expect(() => parseCardText([{ text: s }, { text: '\u0000‮＠＠@@..' }])).not.toThrow();
    }
  });
  it('an envelope for another purpose cannot be opened as a record (type confusion)', async () => {
    const created = await createVault(p);
    const blobEnv = await (await import('@/core/crypto/records')).sealBlob(p, created.keys, 'b_000000000000000000000001', new Uint8Array([1, 2, 3]));
    await expect(openEnvelope(p, created.keys.recordKey, { purpose: 'record', vaultId: created.keys.vaultId, objectId: 'b_000000000000000000000001', keyVersion: 1 }, blobEnv)).rejects.toBeInstanceOf(DecryptionError);
  });
});
