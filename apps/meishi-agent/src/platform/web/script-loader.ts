// Loads same-origin vendor scripts (CSP: script-src 'self'). Nothing is fetched from a CDN.
import { trustedScriptURL } from './trusted-types';
const loaded = new Map<string, Promise<void>>();

export function loadScript(src: string, type: 'classic' | 'module' = 'classic'): Promise<void> {
  let p = loaded.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const el = document.createElement('script');
      el.src = trustedScriptURL(src);
      if (type === 'module') el.type = 'module';
      el.onload = () => resolve();
      el.onerror = () => {
        loaded.delete(src);
        reject(new Error(`読み込みに失敗しました: ${src}`));
      };
      document.head.appendChild(el);
    });
    loaded.set(src, p);
  }
  return p;
}
