// A simulated device: its own encrypted store, session, API client (bearer token) and sync engine.
import { ApiClient } from '@/core/sync/api-client';
import { SyncEngine, type SyncState } from '@/core/sync/engine';
import { createMemoryStore } from '@/core/store/memory-store';
import { VaultSession } from '@/core/store/session';
import { META } from '@/core/store/types';
import { createVault, unlockWithRecoveryKey } from '@/core/crypto/vault';
import { createWebCryptoProvider } from '@/core/crypto/webcrypto';
import type { TestServer } from './server';

export async function signIn(server: TestServer, email: string, label: string) {
  let token: string | null = null;
  const api = new ApiClient({ baseUrl: server.baseUrl, client: 'native', getToken: async () => token });
  const { challengeId } = await api.startSignIn(email);
  const res = await api.verifySignIn(challengeId, server.otps.get(email)!, label);
  token = res.token!;
  return { api, deviceId: res.deviceId, accountId: res.accountId, hasVault: res.hasVault, token };
}

export async function makeDevice(server: TestServer, email: string, label: string, recoveryKey?: string) {
  const provider = createWebCryptoProvider();
  const store = createMemoryStore();
  const session = new VaultSession({ provider, store });
  const auth = await signIn(server, email, label);
  let key = recoveryKey;
  if (!auth.hasVault) {
    const created = await createVault(provider);
    await auth.api.putRecoveryEnvelope(created.recoveryEnvelope);
    await session.open(created.keys);
    key = created.recoveryKey;
  } else {
    const env = await auth.api.getRecoveryEnvelope();
    await session.open(await unlockWithRecoveryKey(provider, env!, key!));
  }
  await store.setMeta(META.sync, { cursor: 0, deviceId: auth.deviceId } satisfies SyncState);
  const engine = new SyncEngine(session, auth.api, {
    load: async () => (await store.getMeta<SyncState>(META.sync))!,
    save: (s) => store.setMeta(META.sync, s),
  });
  return { provider, store, session, engine, ...auth, recoveryKey: key! };
}
