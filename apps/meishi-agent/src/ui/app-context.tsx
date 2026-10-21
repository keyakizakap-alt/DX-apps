import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Platform } from 'react-native';
import type { AppController, AppState } from '../core/controller';
import type { ExternalPreview } from '../core/ai/external';
import { fromBase64, toBase64 } from '../core/crypto/bytes';

const Ctx = createContext<AppController | null>(null);

export function AppProvider({ controller, children }: { controller: AppController; children: ReactNode }) {
  return <Ctx.Provider value={controller}>{children}</Ctx.Provider>;
}

export function useApp(): AppController {
  const c = useContext(Ctx);
  if (!c) throw new Error('AppProvider missing');
  return c;
}

export function useAppState(): AppState {
  const app = useApp();
  return useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
}

/** Re-renders whenever decrypted vault data changes; returns the session for reads. */
export function useVault() {
  const app = useApp();
  useSyncExternalStore(
    (l) => app.session?.subscribe(l) ?? (() => {}),
    () => app.session?.snapshot ?? 0,
    () => 0,
  );
  return app.session;
}

/** Decrypts an image blob for display; the object URL is revoked when the component unmounts. */
export function useDecryptedImage(blobId: string | undefined): { uri?: string; error?: string; loading: boolean } {
  const app = useApp();
  // Result is tagged with the blob it belongs to, so a stale result is never shown for a new blob.
  const [state, setState] = useState<{ for?: string; uri?: string; error?: string }>({});
  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    if (!blobId) return;
    app.session
      .getImage(blobId, app.state.account ? (id) => app.api.getBlob(id) : undefined)
      .then((bytes) => {
        if (cancelled) return;
        if (!bytes) return setState({ for: blobId, error: '画像がこの端末にありません（同期待ちの可能性）' });
        url = Platform.OS === 'web' ? URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })) : `data:image/jpeg;base64,${toBase64(bytes)}`;
        setState({ for: blobId, uri: url });
      })
      .catch(() => !cancelled && setState({ for: blobId, error: '画像を復号できませんでした' }));
    return () => {
      cancelled = true;
      if (url && Platform.OS === 'web' && url.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [blobId, app]);
  if (!blobId) return { loading: false };
  return state.for === blobId ? { uri: state.uri, error: state.error, loading: false } : { loading: true };
}

// In-memory hand-off between S11 and S12 (never persisted).
let pendingPreview: ExternalPreview | null = null;
export const externalPreviewSlot = {
  set(p: ExternalPreview | null) {
    pendingPreview = p;
  },
  get() {
    return pendingPreview;
  },
};

export { fromBase64 };
