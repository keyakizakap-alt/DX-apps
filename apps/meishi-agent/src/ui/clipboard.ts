// Copy of a sensitive value (recovery key, phone, e-mail, draft). Cleared after 60 seconds if the
// clipboard still holds it (native can compare; the web clears best-effort while focused).
import * as Clipboard from 'expo-clipboard';
import { Platform } from 'react-native';

export const CLIPBOARD_CLEAR_MS = 60_000;
let timer: ReturnType<typeof setTimeout> | null = null;

export async function copySensitive(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void (async () => {
      try {
        if (Platform.OS === 'web') {
          if (document.hasFocus()) await navigator.clipboard.writeText('');
        } else if ((await Clipboard.getStringAsync()) === text) {
          await Clipboard.setStringAsync('');
        }
      } catch {
        // permission denied / not focused: nothing more can be done safely
      }
    })();
  }, CLIPBOARD_CLEAR_MS);
}
