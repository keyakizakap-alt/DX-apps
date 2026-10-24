import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64, utf8 } from '@/core/crypto/bytes';
import { DecryptionError } from '@/core/crypto/provider';
import { openRecord, sealRecord } from '@/core/crypto/records';
import { formatRecoveryKey, normalizeRecoveryKeyInput, parseRecoveryKey, pickConfirmationGroups, recoveryKeyGroup, RecoveryKeyFormatError } from '@/core/crypto/recovery-key';
import { createVault, unlockWithPasscode, unlockWithRecoveryKey, wrapWithPasscode } from '@/core/crypto/vault';
import { createWebCryptoProvider, pbkdf2Sha256 } from '@/core/crypto/webcrypto';

const p = createWebCryptoProvider();

describe('vault & recovery key (SEC-04, SEC-08, SEC-17)', () => {
  it('a second device restores the vault with the recovery key and reads records sealed by the first', async () => {
    const created = await createVault(p);
    const env = await sealRecord(p, created.keys, 'c_1', { name: '架空 一郎' });
    const restored = await unlockWithRecoveryKey(p, created.recoveryEnvelope, created.recoveryKey);
    expect(await openRecord(p, restored, 'c_1', env), '復旧キーで開いた鍵で既存レコードが読めない。直し方: deriveVaultKeys の salt/info を確認する').toEqual({ name: '架空 一郎' });
  });

  it('recovery key format: prefix + 11 groups of 5, checksum catches typos, tolerant of case/spaces', async () => {
    // Fixed bytes keep the typo sweep deterministic (a random key could collide with the 16-bit checksum).
    const recoveryKey = await formatRecoveryKey(Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff), p.sha256);
    expect(recoveryKey).toMatch(/^MK1(-[0-9A-HJKMNP-TV-Z]{5}){11}$/);
    await expect(parseRecoveryKey(recoveryKey.toLowerCase().replaceAll('-', ' '), p.sha256)).resolves.toHaveLength(32);
    for (let i = 4; i < recoveryKey.length; i++) {
      if (recoveryKey[i] === '-') continue;
      const typo = recoveryKey.slice(0, i) + (recoveryKey[i] === '2' ? '3' : '2') + recoveryKey.slice(i + 1);
      await expect(parseRecoveryKey(typo, p.sha256), `位置${i}の1文字違いが受理された。直し方: チェックサムと非正規パディングの拒否を確認する`).rejects.toBeInstanceOf(RecoveryKeyFormatError);
    }
    expect(normalizeRecoveryKeyInput('mk1-abcde-io')).toBe('ABCDE10');
  });

  it('a different (well-formed) recovery key cannot unlock: authentication alone never decrypts', async () => {
    const a = await createVault(p);
    const b = await createVault(p);
    await expect(unlockWithRecoveryKey(p, a.recoveryEnvelope, b.recoveryKey)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('the recovery envelope does not contain the VMK or the recovery key in clear', async () => {
    let vmkCopy: Uint8Array | undefined;
    const created = await createVault(p, async (vmk) => {
      vmkCopy = vmk.slice();
    });
    const raw = fromBase64(created.recoveryEnvelope.envelope);
    const hay = Buffer.from(raw).toString('hex');
    expect(hay.includes(Buffer.from(vmkCopy!).toString('hex'))).toBe(false);
    expect(JSON.stringify(created.recoveryEnvelope).includes(created.recoveryKey)).toBe(false);
  });

  it('records sealed under one vault do not open under another', async () => {
    const a = await createVault(p);
    const b = await createVault(p);
    const env = await sealRecord(p, a.keys, 'c_1', { x: 1 });
    await expect(openRecord(p, b.keys, 'c_1', env)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('confirmation groups are two distinct indexes within 1..11', () => {
    for (let i = 0; i < 100; i++) {
      const [a, b] = pickConfirmationGroups((n) => p.randomBytes(n));
      expect(a).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(11);
      expect(a).toBeLessThan(b);
    }
    expect(recoveryKeyGroup('MK1-AAAAA-BBBBB', 2)).toBe('BBBBB');
  });
});

describe('device passcode wrap (web)', () => {
  const pbkdf2 = (pw: string, salt: Uint8Array, it: number) => pbkdf2Sha256(pw, salt, it);
  it('requires both the passcode and the device key', async () => {
    let wrapped: Awaited<ReturnType<typeof wrapWithPasscode>> | undefined;
    const deviceKey = await p.importAeadKey(p.randomBytes(32));
    const otherDevice = await p.importAeadKey(p.randomBytes(32));
    const created = await createVault(p, async (vmk, vaultId) => {
      wrapped = await wrapWithPasscode(p, pbkdf2, deviceKey, vmk, vaultId, '正しい合言葉-2026', 1000);
    });
    const keys = await unlockWithPasscode(p, pbkdf2, deviceKey, wrapped!, '正しい合言葉-2026');
    const env = await sealRecord(p, created.keys, 'c_9', { ok: true });
    expect(await openRecord(p, keys, 'c_9', env)).toEqual({ ok: true });
    await expect(unlockWithPasscode(p, pbkdf2, deviceKey, wrapped!, 'wrong')).rejects.toBeInstanceOf(DecryptionError);
    await expect(unlockWithPasscode(p, pbkdf2, otherDevice, wrapped!, '正しい合言葉-2026')).rejects.toBeInstanceOf(DecryptionError);
    expect(wrapped!.envelope.includes(toBase64(utf8('正しい合言葉-2026')))).toBe(false);
  });
});
