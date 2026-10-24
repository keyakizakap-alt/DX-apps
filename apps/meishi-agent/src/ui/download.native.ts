// Saving files on iOS / Android: write to a private cache folder, open the OS share sheet (the user
// picks Files / Drive / AirDrop …), then delete the temporary copy. Plaintext exports therefore do
// not linger in the app's cache.
// STATUS: written against the expo-file-system / expo-sharing SDK 58 type declarations; not yet run
// on a device (see docs/PROGRESS.md).
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const EXPORT_DIR = 'meishi-export';

/** Removes leftovers from an earlier share that was interrupted (app killed while the sheet was open). */
export function clearExportCache() {
  const dir = new Directory(Paths.cache, EXPORT_DIR);
  if (dir.exists) dir.delete();
}

export async function downloadText(text: string, filename: string, type = 'text/plain;charset=utf-8'): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('この端末では共有機能を利用できません');
  clearExportCache();
  const dir = new Directory(Paths.cache, EXPORT_DIR);
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, filename.replace(/[^\w.-]/g, '_'));
  try {
    file.create({ overwrite: true });
    await file.write(text);
    await Sharing.shareAsync(file.uri, { mimeType: type.split(';')[0], dialogTitle: filename });
  } finally {
    if (file.exists) file.delete();
  }
}
