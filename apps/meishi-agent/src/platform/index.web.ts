// Web (iPhone Safari / Android Chrome / Windows & Mac browsers) platform wiring.
import type { Platform } from '../core/controller';
import { adoptWebAeadKey, createWebCryptoProvider, pbkdf2Sha256 } from '../core/crypto/webcrypto';
import { META } from '../core/store/types';
import { openIndexedDbStore } from './indexeddb-store';
import { createTesseractOcr } from './web/tesseract-ocr';

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : 'ブラウザ';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} ${browser}`;
}

export function createPlatform(): Platform {
  if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) {
    throw new Error('このページはHTTPS（またはlocalhost）で開いてください。暗号化機能（WebCrypto）が使えません。');
  }
  return {
    kind: 'web',
    provider: createWebCryptoProvider(),
    openStore: () => openIndexedDbStore(),
    ocr: createTesseractOcr(),
    api: { baseUrl: '', client: 'web' },
    deviceLabel,
    tokenStore: { get: async () => null, set: async () => {} }, // HttpOnly cookie
    passcode: {
      async deviceKey(store) {
        let key = await store.getMeta<CryptoKey>(META.deviceKey);
        if (!key) {
          key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
          await store.setMeta(META.deviceKey, key);
        }
        return adoptWebAeadKey(key);
      },
      pbkdf2: (pw, salt, it) => pbkdf2Sha256(pw, salt, it),
    },
    isOnline: () => navigator.onLine,
    onOnlineChange(cb) {
      const on = () => cb(true);
      const off = () => cb(false);
      window.addEventListener('online', on);
      window.addEventListener('offline', off);
      return () => {
        window.removeEventListener('online', on);
        window.removeEventListener('offline', off);
      };
    },
  };
}
