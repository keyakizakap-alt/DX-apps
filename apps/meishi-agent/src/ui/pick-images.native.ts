// iOS/Android capture via expo-image-picker (camera or library), resized/re-encoded on device
// with expo-image-manipulator (drops EXIF). NOT verified on a device in this environment.
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { fromBase64 } from '../core/crypto/bytes';

export async function pickImages(source: 'camera' | 'files' | File[]): Promise<{ images: { jpeg: Uint8Array; sourceName?: string }[]; errors: string[] }> {
  if (Array.isArray(source)) return { images: [], errors: ['この端末ではドラッグ＆ドロップに対応していません'] };
  const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { images: [], errors: ['カメラ/写真へのアクセスが許可されていません。端末の設定から許可してください。'] };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync({ quality: 1, exif: false }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 50, exif: false });
  if (result.canceled) return { images: [], errors: [] };
  const images: { jpeg: Uint8Array; sourceName?: string }[] = [];
  const errors: string[] = [];
  for (const asset of result.assets) {
    try {
      const ctx = ImageManipulator.manipulate(asset.uri);
      if (Math.max(asset.width, asset.height) > 1600) ctx.resize(asset.width >= asset.height ? { width: 1600 } : { height: 1600 });
      const rendered = await ctx.renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
      if (!saved.base64) throw new Error('no data');
      images.push({ jpeg: fromBase64(saved.base64), sourceName: asset.fileName ?? undefined });
      deleteTemp(saved.uri);
    } catch {
      errors.push('画像を処理できませんでした');
    } finally {
      // The picker/manipulator leave plaintext copies in the app cache; remove them once encrypted.
      if (source === 'camera') deleteTemp(asset.uri);
    }
  }
  return { images, errors };
}

function deleteTemp(uri: string | undefined) {
  try {
    if (uri?.startsWith('file://')) new File(uri).delete();
  } catch {
    // best effort; verified only by type declarations (device test pending)
  }
}
