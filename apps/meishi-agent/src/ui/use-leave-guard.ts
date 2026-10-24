import { useEffect } from 'react';
import { Platform } from 'react-native';

/** Warns before closing/reloading the tab while a form has unsaved changes (web). */
export function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
