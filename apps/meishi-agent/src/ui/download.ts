// Saving files: web downloads; native shares via the OS sheet is not wired yet (see PROGRESS).
import { Platform } from 'react-native';

export function downloadText(text: string, filename: string, type = 'text/plain;charset=utf-8') {
  if (Platform.OS !== 'web') throw new Error('この端末ではファイル保存に未対応です');
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
