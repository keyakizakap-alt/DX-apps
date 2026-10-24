// Web image intake used by S04. (Native capture is in pick-images.native.ts.)
import { ImportError, pickFiles, processImageFile } from '../platform/web/image';

export async function pickImages(source: 'camera' | 'files' | File[]): Promise<{ images: { jpeg: Uint8Array; sourceName?: string }[]; errors: string[] }> {
  const files = Array.isArray(source) ? source : await pickFiles({ capture: source === 'camera', multiple: source === 'files' });
  const images: { jpeg: Uint8Array; sourceName?: string }[] = [];
  const errors: string[] = [];
  for (const f of files) {
    try {
      images.push(...(await processImageFile(f)));
    } catch (e) {
      errors.push(e instanceof ImportError ? e.message : `${f.name}: 取り込めませんでした（${e instanceof Error ? e.message.slice(0, 120) : '不明なエラー'}）`);
    }
  }
  return { images, errors };
}
