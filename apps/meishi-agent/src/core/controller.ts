// Application controller shared by every screen. Platform-neutral (no React / RN imports) so the
// full lifecycle — create vault, lock/unlock, sync, import — is testable in Node.
import { readAudit, recordAudit, type AuditEvent } from './audit';
import { DecryptionError, type CryptoProvider } from './crypto/provider';
import { RecoveryKeyFormatError, pickConfirmationGroups, recoveryKeyGroup } from './crypto/recovery-key';
import { createVault, deriveVaultKeys, unlockWithPasscode, unlockWithRecoveryKey, wrapWithPasscode, type CreatedVault, type PasscodeEnvelope, type Pbkdf2, type RecoveryEnvelope } from './crypto/vault';
import type { AeadKey } from './crypto/provider';
import { recoverInterrupted, runQueue, type QueueRunner } from './scan/queue';
import type { OcrEngine } from './scan/ocr';
import { VaultSession } from './store/session';
import { META, type EncryptedStore } from './store/types';
import { ApiClient, type ApiClientOptions } from './sync/api-client';
import { SyncEngine, type SyncReport, type SyncState } from './sync/engine';
import { SyncHttpError } from './sync/protocol';

export interface Platform {
  kind: 'web' | 'native';
  provider: CryptoProvider;
  openStore(): Promise<EncryptedStore>;
  ocr: OcrEngine;
  api: ApiClientOptions;
  deviceLabel(): string;
  /** Native: persist the bearer token in the OS key store. Web: cookie, so these are no-ops. */
  tokenStore: { get(): Promise<string | null>; set(token: string | null): Promise<void> };
  /** Web passcode support: a non-extractable per-device key + PBKDF2. */
  passcode?: { deviceKey(store: EncryptedStore): Promise<AeadKey>; pbkdf2: Pbkdf2 };
  /** Native biometric unlock (Face ID / fingerprint) via the OS key store. */
  biometric?: { available(): Promise<boolean>; save(vmk: Uint8Array): Promise<void>; load(): Promise<Uint8Array | null>; clear(): Promise<void> };
  isOnline(): boolean;
  onOnlineChange(cb: (online: boolean) => void): () => void;
}

export interface Settings {
  externalAiEnabled: boolean;
  autoLockMinutes: number; // 0 = never (not recommended)
  lockWhenHidden: boolean;
  notificationsShowNames: boolean; // reserved; notifications are not implemented
}

export const DEFAULT_SETTINGS: Settings = { externalAiEnabled: false, autoLockMinutes: 5, lockWhenHidden: true, notificationsShowNames: false };

export type Phase = 'booting' | 'welcome' | 'confirm_recovery' | 'locked' | 'unlocked' | 'fatal';

export type SyncStatus = 'local_only' | 'idle' | 'pending' | 'syncing' | 'offline' | 'error' | 'auth_expired';

export interface Account {
  accountId: string;
  deviceId: string;
}

interface VaultMeta {
  recoveryEnvelope: RecoveryEnvelope;
  createdAt: string;
  recoveryConfirmed: boolean;
}

interface UnlockAttempts {
  failures: number;
  lockedUntil: number;
}

export interface AppState {
  phase: Phase;
  fatal?: string;
  storeKind?: EncryptedStore['kind'];
  account: Account | null;
  hasPasscode: boolean;
  biometricAvailable: boolean;
  online: boolean;
  sync: { status: SyncStatus; lastSyncAt?: string; lastError?: string; pending: number; conflicts: number; lastReport?: SyncReport };
  unlockLockedUntil: number;
  settings: Settings;
  pendingRecovery?: { recoveryKey: string; groups: [number, number] };
  aiServer: { available: boolean; destination: string | null } | null;
  ocrRunning: boolean;
  revision: number;
}

export class UnlockThrottledError extends Error {
  constructor(readonly waitMs: number) {
    super(`試行回数が多すぎます。${Math.ceil(waitMs / 1000)}秒後に再試行してください。`);
  }
}

export class AppController {
  session!: VaultSession;
  private store!: EncryptedStore;
  readonly api: ApiClient;
  private engine: SyncEngine | null = null;
  private listeners = new Set<() => void>();
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: QueueRunner | null = null;
  private pendingVault: CreatedVault | null = null;
  private pendingVmkForPasscode: Uint8Array | null = null;
  private challengeId: string | null = null;
  state: AppState;

  constructor(
    readonly platform: Platform,
    private readonly clock: () => number = Date.now,
  ) {
    this.api = new ApiClient({ ...platform.api, getToken: platform.tokenStore.get });
    this.state = {
      phase: 'booting',
      account: null,
      hasPasscode: false,
      biometricAvailable: false,
      online: platform.isOnline(),
      sync: { status: 'local_only', pending: 0, conflicts: 0 },
      unlockLockedUntil: 0,
      settings: DEFAULT_SETTINGS,
      aiServer: null,
      ocrRunning: false,
      revision: 0,
    };
    platform.onOnlineChange((online) => {
      this.set({ online });
      if (online) this.scheduleSync(500);
    });
  }

  // ---- observable state -----------------------------------------------------------------------

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    this.listeners.forEach((l) => l());
  }

  private refreshCounts() {
    if (!this.session) return;
    const sync = { ...this.state.sync, pending: this.session.unlocked ? this.session.pendingCount : 0, conflicts: this.session.unlocked ? this.session.conflicts.length : 0 };
    if (this.state.account && sync.status === 'idle' && sync.pending > 0) sync.status = 'pending';
    this.set({ sync });
    if (sync.pending > 0 && sync.status !== 'syncing') this.scheduleSync();
  }

  // ---- boot / vault lifecycle -----------------------------------------------------------------

  async boot(): Promise<void> {
    try {
      this.store = await this.platform.openStore();
      this.session = new VaultSession({ provider: this.platform.provider, store: this.store, now: () => new Date(this.clock()) });
      this.session.subscribe(() => this.refreshCounts());
    } catch (e) {
      this.set({ phase: 'fatal', fatal: e instanceof Error ? e.message : '端末の保存領域を開けませんでした' });
      return;
    }
    const [vault, passcode, sync, settings, attempts] = await Promise.all([
      this.store.getMeta<VaultMeta>(META.vault),
      this.store.getMeta<PasscodeEnvelope>(META.passcode),
      this.store.getMeta<SyncState & { accountId?: string }>(META.sync),
      this.store.getMeta<Settings>(META.settings),
      this.store.getMeta<UnlockAttempts>(META.unlockAttempts),
    ]);
    const account = sync?.accountId ? { accountId: sync.accountId, deviceId: sync.deviceId } : null;
    this.set({
      storeKind: this.store.kind,
      account,
      hasPasscode: Boolean(passcode),
      biometricAvailable: (await this.platform.biometric?.available()) ?? false,
      settings: { ...DEFAULT_SETTINGS, ...settings },
      unlockLockedUntil: attempts?.lockedUntil ?? 0,
      sync: { ...this.state.sync, status: account ? 'idle' : 'local_only', lastSyncAt: sync?.lastSyncAt },
      phase: vault?.recoveryConfirmed ? 'locked' : 'welcome',
    });
    void this.checkServer();
  }

  async checkServer() {
    try {
      const h = await this.api.health();
      this.set({ aiServer: { available: h.ai, destination: h.aiDestination } });
    } catch {
      this.set({ aiServer: null });
    }
  }

  /** S01: generate the vault and recovery key. Nothing is usable until the key is confirmed. */
  async beginCreateVault(): Promise<{ recoveryKey: string; groups: [number, number] }> {
    let vmkCopy: Uint8Array | null = null;
    this.pendingVault = await createVault(this.platform.provider, async (vmk) => {
      vmkCopy = vmk.slice(); // kept in memory only until confirmation, for optional passcode/biometric setup
    });
    this.pendingVmkForPasscode = vmkCopy;
    const groups = pickConfirmationGroups((n) => this.platform.provider.randomBytes(n));
    const pendingRecovery = { recoveryKey: this.pendingVault.recoveryKey, groups };
    this.set({ phase: 'confirm_recovery', pendingRecovery });
    return pendingRecovery;
  }

  /** S01 confirmation: the user re-types two groups of the key. */
  async confirmRecoveryKey(answers: [string, string], passcode?: string): Promise<void> {
    const pending = this.pendingVault;
    const groups = this.state.pendingRecovery?.groups;
    if (!pending || !groups) throw new Error('保管庫の作成からやり直してください');
    const norm = (s: string) => s.toUpperCase().replace(/\s/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
    if (norm(answers[0]) !== recoveryKeyGroup(pending.recoveryKey, groups[0]) || norm(answers[1]) !== recoveryKeyGroup(pending.recoveryKey, groups[1])) {
      throw new RecoveryKeyFormatError();
    }
    await this.store.setMeta(META.vault, { recoveryEnvelope: pending.recoveryEnvelope, createdAt: new Date(this.clock()).toISOString(), recoveryConfirmed: true } satisfies VaultMeta);
    await this.rememberVmk(this.pendingVmkForPasscode, pending.keys.vaultId, passcode);
    this.pendingVmkForPasscode?.fill(0);
    this.pendingVmkForPasscode = null;
    await this.openSession(pending.keys);
    await this.session.audit('vault.create');
    if (this.state.account) {
      await this.api.putRecoveryEnvelope(pending.recoveryEnvelope).catch(() => undefined);
      this.scheduleSync(0);
    }
    this.pendingVault = null;
    this.set({ pendingRecovery: undefined });
  }

  cancelCreateVault() {
    this.pendingVault = null;
    this.pendingVmkForPasscode?.fill(0);
    this.pendingVmkForPasscode = null;
    this.set({ phase: 'welcome', pendingRecovery: undefined });
  }

  /** Existing account on a new device: fetch the recovery envelope and open it with the key. */
  async restoreFromServer(recoveryKey: string, passcode?: string): Promise<void> {
    await this.throttle();
    const env = await this.api.getRecoveryEnvelope();
    if (!env) throw new Error('このアカウントには保管庫がまだありません。「新しく始める」を選んでください。');
    let vmkCopy: Uint8Array | null = null;
    try {
      const keys = await unlockWithRecoveryKey(this.platform.provider, env, recoveryKey, async (vmk) => {
        vmkCopy = vmk.slice();
      });
      await this.store.setMeta(META.vault, { recoveryEnvelope: env, createdAt: new Date(this.clock()).toISOString(), recoveryConfirmed: true } satisfies VaultMeta);
      await this.rememberVmk(vmkCopy, keys.vaultId, passcode);
      await this.unlockSucceeded();
      await this.openSession(keys);
      this.scheduleSync(0);
    } catch (e) {
      if (e instanceof DecryptionError) await this.unlockFailed();
      throw e;
    } finally {
      (vmkCopy as Uint8Array | null)?.fill(0);
    }
  }

  async unlockWithRecoveryKey(recoveryKey: string, newPasscode?: string): Promise<void> {
    await this.throttle();
    const vault = await this.store.getMeta<VaultMeta>(META.vault);
    if (!vault) throw new Error('この端末に保管庫がありません');
    let vmkCopy: Uint8Array | null = null;
    try {
      const keys = await unlockWithRecoveryKey(this.platform.provider, vault.recoveryEnvelope, recoveryKey, async (vmk) => {
        vmkCopy = vmk.slice();
      });
      await this.rememberVmk(vmkCopy, keys.vaultId, newPasscode);
      await this.unlockSucceeded();
      await this.openSession(keys);
    } catch (e) {
      if (e instanceof DecryptionError || e instanceof RecoveryKeyFormatError) await this.unlockFailed();
      throw e;
    } finally {
      (vmkCopy as Uint8Array | null)?.fill(0);
    }
  }

  async unlockWithPasscode(passcode: string): Promise<void> {
    await this.throttle();
    const env = await this.store.getMeta<PasscodeEnvelope>(META.passcode);
    if (!env || !this.platform.passcode) throw new Error('この端末にはパスコードが設定されていません');
    try {
      const keys = await unlockWithPasscode(this.platform.provider, this.platform.passcode.pbkdf2, await this.platform.passcode.deviceKey(this.store), env, passcode);
      await this.unlockSucceeded();
      await this.openSession(keys);
    } catch (e) {
      if (e instanceof DecryptionError) {
        const attempts = await this.unlockFailed();
        if (attempts >= 10) {
          // Too many wrong passcodes: remove the passcode wrap; the recovery key is now required.
          await this.store.deleteMeta(META.passcode);
          this.set({ hasPasscode: false });
          throw new Error('パスコードの誤りが続いたため、この端末のパスコードを無効にしました。復旧キーで解除してください。');
        }
        throw new Error('パスコードが違います');
      }
      throw e;
    }
  }

  async clearPasscode() {
    await this.store.deleteMeta(META.passcode);
    await this.session.audit('vault.passcode_cleared');
    this.set({ hasPasscode: false });
  }

  /** Native: Face ID / fingerprint releases the VMK from the OS key store. Recovery key remains the fallback. */
  async unlockWithBiometric(): Promise<void> {
    await this.throttle();
    const vault = await this.store.getMeta<VaultMeta>(META.vault);
    if (!vault || !this.platform.biometric) throw new Error('生体認証は利用できません');
    const vmk = await this.platform.biometric.load();
    if (!vmk) throw new Error('生体認証が取り消されたか、登録が変更されました。復旧キーで解除してください。');
    try {
      const keys = await deriveVaultKeys(this.platform.provider, vmk, vault.recoveryEnvelope.vaultId, vault.recoveryEnvelope.keyVersion);
      await this.unlockSucceeded();
      await this.openSession(keys);
    } finally {
      vmk.fill(0);
    }
  }

  private async rememberVmk(vmk: Uint8Array | null, vaultId: string, passcode?: string) {
    if (!vmk) return;
    if (passcode) await this.storePasscode(vmk, vaultId, passcode);
    if (this.platform.biometric && this.state.biometricAvailable) await this.platform.biometric.save(vmk);
  }

  private async storePasscode(vmk: Uint8Array, vaultId: string, passcode: string) {
    if (!this.platform.passcode) return;
    if (passcode.length < 8) throw new Error('パスコードは8文字以上にしてください');
    const env = await wrapWithPasscode(this.platform.provider, this.platform.passcode.pbkdf2, await this.platform.passcode.deviceKey(this.store), vmk, vaultId, passcode);
    await this.store.setMeta(META.passcode, env);
    this.set({ hasPasscode: true });
  }

  private async throttle() {
    const wait = this.state.unlockLockedUntil - this.clock();
    if (wait > 0) throw new UnlockThrottledError(wait);
  }

  private async unlockFailed(): Promise<number> {
    const prev = (await this.store.getMeta<UnlockAttempts>(META.unlockAttempts)) ?? { failures: 0, lockedUntil: 0 };
    const failures = prev.failures + 1;
    // Exponential back-off from the 3rd failure: 2s, 4s, 8s … capped at 5 minutes.
    const lockedUntil = failures >= 3 ? this.clock() + Math.min(300_000, 1000 * 2 ** (failures - 2)) : 0;
    await this.store.setMeta(META.unlockAttempts, { failures, lockedUntil });
    await this.auditLocked('vault.unlock_failed');
    this.set({ unlockLockedUntil: lockedUntil });
    return failures;
  }

  private async unlockSucceeded() {
    await this.store.setMeta(META.unlockAttempts, { failures: 0, lockedUntil: 0 });
    this.set({ unlockLockedUntil: 0 });
  }

  /** Audit while locked (no session): append through the store directly. */
  private async auditLocked(action: 'vault.unlock_failed') {
    await recordAudit(this.store, action, 1, 'failure', new Date(this.clock()));
  }

  private async openSession(keys: Parameters<VaultSession['open']>[0]) {
    const report = await this.session.open(keys);
    await this.session.audit('vault.unlock');
    if (report.unreadable > 0) await this.session.audit('sync.error', report.unreadable, 'failure');
    await recoverInterrupted(this.session);
    this.set({ phase: 'unlocked' });
    this.touch();
    this.startQueue();
    this.setupEngine();
    this.refreshCounts();
  }

  lock(reason: 'manual' | 'auto' | 'hidden' = 'manual') {
    if (!this.session.unlocked) return;
    this.queue?.stop();
    this.queue = null;
    void this.session.audit('vault.lock').catch(() => undefined);
    this.session.lock();
    if (this.lockTimer) clearTimeout(this.lockTimer);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.set({ phase: 'locked', ocrRunning: false });
    void reason;
  }

  /** Call on user activity; restarts the auto-lock countdown. */
  touch() {
    if (!this.session.unlocked) return;
    if (this.lockTimer) clearTimeout(this.lockTimer);
    const minutes = this.state.settings.autoLockMinutes;
    if (minutes > 0) this.lockTimer = setTimeout(() => this.lock('auto'), minutes * 60_000);
  }

  onVisibilityChange(hidden: boolean) {
    if (hidden && this.state.settings.lockWhenHidden) this.lock('hidden');
  }

  async updateSettings(patch: Partial<Settings>) {
    const settings = { ...this.state.settings, ...patch };
    await this.store.setMeta(META.settings, settings);
    if (this.session.unlocked) await this.session.audit('settings.change');
    this.set({ settings });
    this.touch();
  }

  // ---- account / sync --------------------------------------------------------------------------

  async startSignIn(email: string) {
    const r = await this.api.startSignIn(email.trim());
    this.challengeId = r.challengeId;
    return r;
  }

  async verifySignIn(code: string): Promise<{ hasVault: boolean }> {
    if (!this.challengeId) throw new Error('確認コードをもう一度送信してください');
    const r = await this.api.verifySignIn(this.challengeId, code.trim(), this.platform.deviceLabel());
    if (r.token) await this.platform.tokenStore.set(r.token);
    const account = { accountId: r.accountId, deviceId: r.deviceId };
    const prev = await this.store.getMeta<SyncState & { accountId?: string }>(META.sync);
    // A different account on this device restarts the change cursor.
    await this.store.setMeta(META.sync, { cursor: prev?.accountId === r.accountId ? prev.cursor : 0, deviceId: r.deviceId, accountId: r.accountId });
    this.set({ account, sync: { ...this.state.sync, status: 'idle' } });
    if (this.session.unlocked) {
      await this.session.audit('auth.sign_in');
      const vault = await this.store.getMeta<VaultMeta>(META.vault);
      if (vault && !r.hasVault) await this.api.putRecoveryEnvelope(vault.recoveryEnvelope);
      this.setupEngine();
      this.scheduleSync(0);
    }
    return { hasVault: r.hasVault };
  }

  async signOut() {
    await this.api.signOut().catch(() => undefined);
    await this.platform.tokenStore.set(null);
    const prev = await this.store.getMeta<SyncState & { accountId?: string }>(META.sync);
    if (prev) await this.store.setMeta(META.sync, { ...prev, accountId: undefined });
    this.engine = null;
    if (this.session.unlocked) await this.session.audit('auth.sign_out');
    this.set({ account: null, sync: { ...this.state.sync, status: 'local_only' } });
  }

  private setupEngine() {
    if (!this.state.account || !this.session.unlocked) return;
    this.engine = new SyncEngine(this.session, this.api, {
      load: async () => (await this.store.getMeta<SyncState>(META.sync)) ?? { cursor: 0, deviceId: this.state.account!.deviceId },
      save: async (s) => this.store.setMeta(META.sync, { ...s, accountId: this.state.account?.accountId }),
    });
  }

  /** Debounced background sync after local changes. */
  scheduleSync(delayMs = 2000) {
    if (!this.engine || !this.session.unlocked) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => void this.syncNow().catch(() => undefined), delayMs);
  }

  async syncNow(): Promise<SyncReport | null> {
    if (!this.engine) return null;
    if (!this.platform.isOnline()) {
      this.set({ sync: { ...this.state.sync, status: 'offline' } });
      return null;
    }
    this.set({ sync: { ...this.state.sync, status: 'syncing', lastError: undefined } });
    try {
      const report = await this.engine.sync();
      const meta = await this.store.getMeta<SyncState>(META.sync);
      this.set({ sync: { ...this.state.sync, status: 'idle', lastSyncAt: meta?.lastSyncAt, lastReport: report } });
      this.refreshCounts();
      return report;
    } catch (e) {
      const status: SyncStatus = e instanceof SyncHttpError ? (e.code === 'offline' ? 'offline' : e.code === 'unauthorized' ? 'auth_expired' : 'error') : 'error';
      this.set({ sync: { ...this.state.sync, status, lastError: e instanceof Error ? e.message : '同期に失敗しました' } });
      throw e;
    }
  }

  async resolveConflict(objectId: string, choice: 'keep_local' | 'keep_remote' | 'keep_both') {
    if (!this.engine) throw new Error('サインインしていません');
    await this.engine.resolveConflict(objectId, choice);
    this.scheduleSync(0);
  }

  // ---- scanning ------------------------------------------------------------------------------

  startQueue() {
    if (this.queue || !this.session.unlocked) return;
    this.set({ ocrRunning: true });
    const runner = runQueue(this.session, this.platform.ocr);
    this.queue = runner;
    void runner.done.finally(() => {
      if (this.queue === runner) this.queue = null;
      this.set({ ocrRunning: false });
    });
  }

  // ---- misc ------------------------------------------------------------------------------------

  async recoveryEnvelope(): Promise<RecoveryEnvelope | undefined> {
    return (await this.store.getMeta<VaultMeta>(META.vault))?.recoveryEnvelope;
  }

  audit(): Promise<AuditEvent[]> {
    return readAudit(this.store);
  }

  /** Deletes everything stored by this app on this device (not on the server or other devices). */
  async wipeLocal() {
    this.lock();
    await this.store.clearAll();
    await this.platform.tokenStore.set(null);
    await this.platform.biometric?.clear();
    this.set({ phase: 'welcome', account: null, hasPasscode: false, sync: { status: 'local_only', pending: 0, conflicts: 0 } });
  }

  /** Deletes the server account (ciphertext, devices, sessions). Requires a sign-in within 10 minutes. */
  async deleteAccount() {
    await this.api.deleteAccount();
    if (this.session.unlocked) await this.session.audit('account.delete');
    await this.signOut();
  }
}
