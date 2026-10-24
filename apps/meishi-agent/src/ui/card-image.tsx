import { Image, StyleSheet, View } from 'react-native';
import { useDecryptedImage } from './app-context';
import { T } from './components';
import { color } from './theme';

export function CardImage({ blobId, label, height = 220 }: { blobId?: string; label: string; height?: number }) {
  const img = useDecryptedImage(blobId);
  return (
    <View style={[s.frame, { height }]} accessibilityLabel={label}>
      {img.uri ? <Image source={{ uri: img.uri }} style={s.img} resizeMode="contain" accessibilityLabel={label} /> : <T variant="muted">{img.loading ? '画像を復号中…' : img.error ?? '画像なし'}</T>}
    </View>
  );
}

const s = StyleSheet.create({
  frame: { width: '100%', borderRadius: 10, borderWidth: 1, borderColor: color.line, backgroundColor: '#EEF1F5', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  img: { width: '100%', height: '100%' },
});
