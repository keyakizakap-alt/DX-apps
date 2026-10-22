// iOS / Android platform wiring (Expo development build).
// STATUS: implemented against Expo SDK 58 type declarations; NOT built or run on a device in this
// environment (no macOS / Xcode / Apple signing / Android SDK). See docs/PROGRESS.md.
import * as ExpoCrypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { Platform as RNPlatform } from 'react-native';
import type { Platform } from '../core/controller';
import { fromHex, toHex } from '../core/crypto/bytes';
import { createNativeCryptoProvider, type ExpoCryptoLike } from '../core/crypto/native-provider';
import { manualOcr } from '../core/scan/ocr';
import { openSqlCipherStore } from './sqlcipher-store';

const KEYCHAIN = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const DB_KEY = 'meishi.dbkey.v1';
const TOKEN_KEY = 'meishi.session.v1';
const BIO_KEY = 'meishi.vmk.bio.v1';

// Last known reachability. `isInternetReachable` is null until the first probe; treat unknown as
// online so a sync attempt decides (failures are reported as offline and keep local edits).
let online = true;
const reachable = (s: NetInfoState) => s.isConnected !== false && s.isInternetReachable !== false;
NetInfo.addEventListener((s) => {
  online = reachable(s);
});

export function createPlatform(): Platform {
  const provider = createNativeCryptoProvider(ExpoCrypto as unknown as ExpoCryptoLike);
  const syncUrl = (Constants.expoConfig?.extra as { syncUrl?: string } | undefined)?.syncUrl ?? process.env.EXPO_PUBLIC_SYNC_URL ?? '';
  return {
    kind: 'native',
    provider,
    async openStore() {
      let key = await SecureStore.getItemAsync(DB_KEY, KEYCHAIN);
      if (!key) {
        key = toHex(provider.randomBytes(32));
        await SecureStore.setItemAsync(DB_KEY, key, KEYCHAIN);
      }
      return openSqlCipherStore(key);
    },
    // ML Kit Japanese text recognition needs a native module + development build that has not
    // been integrated or verified yet; until then the review screen uses manual entry.
    ocr: manualOcr,
    api: { baseUrl: syncUrl, client: 'native' },
    deviceLabel: () => (RNPlatform.OS === 'ios' ? 'iPhone アプリ' : 'Android アプリ'),
    tokenStore: {
      get: () => SecureStore.getItemAsync(TOKEN_KEY, KEYCHAIN),
      set: async (t) => (t ? SecureStore.setItemAsync(TOKEN_KEY, t, KEYCHAIN) : SecureStore.deleteItemAsync(TOKEN_KEY, KEYCHAIN)),
    },
    biometric: {
      async available() {
        return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync()) && SecureStore.canUseBiometricAuthentication();
      },
      async save(vmk) {
        await SecureStore.setItemAsync(BIO_KEY, toHex(vmk), { ...KEYCHAIN, requireAuthentication: true, authenticationPrompt: '保管庫を開く' });
      },
      async load() {
        const v = await SecureStore.getItemAsync(BIO_KEY, { ...KEYCHAIN, requireAuthentication: true, authenticationPrompt: '保管庫を開く' });
        return v ? fromHex(v) : null;
      },
      clear: () => SecureStore.deleteItemAsync(BIO_KEY, KEYCHAIN),
    },
    isOnline: () => online,
    onOnlineChange: (cb) => {
      let last = online;
      return NetInfo.addEventListener((s) => {
        const now = reachable(s);
        if (now !== last) cb(now);
        last = now;
      });
    },
  };
}
