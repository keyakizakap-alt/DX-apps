import { createWebCryptoProvider, pbkdf2Sha256 } from '@/core/crypto/webcrypto';
import type { Platform } from '@/core/controller';
import { manualOcr } from '@/core/scan/ocr';
import { createMemoryStore } from '@/core/store/memory-store';
import type { EncryptedStore } from '@/core/store/types';
import { META } from '@/core/store/types';

/** Node test platform: memory store, bearer-token client, PBKDF2 with low iterations is NOT used (real 600k). */
export function testPlatform(baseUrl = 'http://127.0.0.1:9', store: EncryptedStore = createMemoryStore()): Platform & { store: EncryptedStore } {
  const provider = createWebCryptoProvider();
  let token: string | null = null;
  let online = true;
  return {
    kind: 'web',
    store,
    provider,
    openStore: async () => store,
    ocr: manualOcr,
    api: { baseUrl, client: 'native' },
    deviceLabel: () => 'Test device',
    tokenStore: { get: async () => token, set: async (t) => void (token = t) },
    passcode: {
      async deviceKey(s) {
        let key = await s.getMeta<CryptoKey>(META.deviceKey);
        if (!key) {
          key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
          await s.setMeta(META.deviceKey, key);
        }
        const { adoptWebAeadKey } = await import('@/core/crypto/webcrypto');
        return adoptWebAeadKey(key);
      },
      pbkdf2: (pw, salt, it) => pbkdf2Sha256(pw, salt, it),
    },
    isOnline: () => online,
    onOnlineChange: () => () => {},
  };
}
