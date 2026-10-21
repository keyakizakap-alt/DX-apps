import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppController, UnlockThrottledError } from '@/core/controller';
import { recoveryKeyGroup } from '@/core/crypto/recovery-key';
import { loadDemoData } from '@/core/demo/fixtures';
import { META } from '@/core/store/types';
import { testPlatform } from '../helpers/platform';
import { startTestServer, type TestServer } from '../helpers/server';

let server: TestServer;
beforeEach(async () => {
  server = await startTestServer();
});
afterEach(async () => server.close());

async function createUnlocked(platform = testPlatform(server.baseUrl), passcode?: string) {
  const app = new AppController(platform);
  await app.boot();
  expect(app.state.phase).toBe('welcome');
  const { recoveryKey, groups } = await app.beginCreateVault();
  await app.confirmRecoveryKey([recoveryKeyGroup(recoveryKey, groups[0]), recoveryKeyGroup(recoveryKey, groups[1])], passcode);
  return { app, recoveryKey, platform };
}

describe('AppController lifecycle', () => {
  it('requires the recovery key confirmation before the vault becomes usable', async () => {
    const app = new AppController(testPlatform(server.baseUrl));
    await app.boot();
    await app.beginCreateVault();
    await expect(app.confirmRecoveryKey(['XXXXX', 'YYYYY'])).rejects.toThrow();
    expect(app.state.phase).toBe('confirm_recovery');
    expect(app.session.unlocked).toBe(false);
  });

  it('lock drops data; wrong keys are throttled; the right key unlocks after reboot', async () => {
    let now = 1_000_000;
    const { app, recoveryKey, platform } = await createUnlocked();
    await loadDemoData(app.session);
    app.lock();
    expect(app.session.all('contact')).toHaveLength(0);

    const rebooted = new AppController(platform, () => now);
    await rebooted.boot();
    expect(rebooted.state.phase).toBe('locked');
    const wrong = 'MK1-' + recoveryKey.slice(4).split('-').reverse().join('-');
    for (let i = 0; i < 3; i++) await expect(rebooted.unlockWithRecoveryKey(wrong)).rejects.toThrow();
    await expect(rebooted.unlockWithRecoveryKey(recoveryKey)).rejects.toBeInstanceOf(UnlockThrottledError);
    now += 60_000;
    await rebooted.unlockWithRecoveryKey(recoveryKey);
    expect(rebooted.session.all('contact')).toHaveLength(9);
    const audit = await rebooted.audit();
    expect(audit.filter((e) => e.action === 'vault.unlock_failed')).toHaveLength(3);
  });

  it('web passcode unlock works, and the stored wrap holds no key material in clear', async () => {
    const { app, platform } = await createUnlocked(undefined, 'correct horse 2026');
    app.lock();
    expect(app.state.hasPasscode).toBe(true);
    await expect(app.unlockWithPasscode('wrong passcode')).rejects.toThrow('パスコードが違います');
    await app.unlockWithPasscode('correct horse 2026');
    expect(app.state.phase).toBe('unlocked');
    const deviceKey = await platform.store.getMeta<CryptoKey>(META.deviceKey);
    expect(deviceKey?.extractable, '端末鍵がエクスポート可能').toBe(false);
  }, 60_000);

  it('signs in, uploads the recovery envelope, syncs, and a second device restores', async () => {
    const { app, recoveryKey } = await createUnlocked();
    await app.startSignIn('owner@example.test');
    await app.verifySignIn(server.otps.get('owner@example.test')!);
    await loadDemoData(app.session);
    const report = await app.syncNow();
    expect(report?.pushed).toBeGreaterThan(0);
    expect(app.state.sync.status).toBe('idle');
    expect(app.state.sync.pending).toBe(0);

    const pc = new AppController(testPlatform(server.baseUrl));
    await pc.boot();
    await pc.startSignIn('owner@example.test');
    expect((await pc.verifySignIn(server.otps.get('owner@example.test')!)).hasVault).toBe(true);
    await pc.restoreFromServer(recoveryKey);
    await pc.syncNow();
    expect(pc.session.all('contact')).toHaveLength(9);
  });

  it('settings default to external AI off and persist', async () => {
    const { app, platform } = await createUnlocked();
    expect(app.state.settings.externalAiEnabled, '外部AIが初期ONになっている').toBe(false);
    await app.updateSettings({ externalAiEnabled: true, autoLockMinutes: 1 });
    const again = new AppController(platform);
    await again.boot();
    expect(again.state.settings).toMatchObject({ externalAiEnabled: true, autoLockMinutes: 1 });
  });

  it('wipeLocal removes everything on this device', async () => {
    const { app, platform } = await createUnlocked();
    await loadDemoData(app.session);
    await app.wipeLocal();
    expect(await platform.store.listRecords()).toHaveLength(0);
    expect(await platform.store.getMeta(META.vault)).toBeUndefined();
    expect(app.state.phase).toBe('welcome');
  });
});
