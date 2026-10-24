// S04 撮影 / 取込: phone camera (rear) or file/PDF selection and drag-and-drop on PC.
// Images are re-encoded on the device, encrypted, and queued; nothing is uploaded for OCR.
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { activeItems, enqueueImages, MAX_SESSION_ITEMS, QueueFullError, type CapturedImage } from '../../../core/scan/queue';
import { useApp, useAppState, useVault } from '../../../ui/app-context';
import { Badge, Banner, Button, Card, Row, Screen, T } from '../../../ui/components';
import { pickImages } from '../../../ui/pick-images';
import { color, DESKTOP_MIN_WIDTH, space } from '../../../ui/theme';

export default function Scan() {
  const app = useApp();
  const state = useAppState();
  const session = useVault();
  const router = useRouter();
  const desktop = useWindowDimensions().width >= DESKTOP_MIN_WIDTH;
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<{ tone: 'ok' | 'warn' | 'danger'; text: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const dropRef = useRef<unknown>(null);
  const inSession = activeItems(session).length;

  const add = async (source: 'camera' | 'files' | File[]) => {
    setBusy(true);
    const notes: typeof messages = [];
    try {
      const { images, errors } = await pickImages(source);
      errors.forEach((e) => notes.push({ tone: 'danger', text: e }));
      if (images.length) {
        try {
          const r = await enqueueImages(session, images as CapturedImage[]);
          notes.push({ tone: 'ok', text: `${r.items.length}枚をキューに追加しました（暗号化して端末に保存）` });
          if (r.duplicates) notes.push({ tone: 'warn', text: `同じ画像 ${r.duplicates}枚はスキップしました` });
        } catch (e) {
          notes.push({ tone: 'warn', text: e instanceof QueueFullError ? e.message : e instanceof Error ? e.message : '追加に失敗しました' });
        }
        app.startQueue();
      }
    } catch (e) {
      notes.push({ tone: 'danger', text: e instanceof Error ? e.message : 'カメラ/ファイルを開けませんでした' });
    } finally {
      setMessages(notes);
      setBusy(false);
    }
  };

  // Drag & drop for PC browsers.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = dropRef.current as unknown as HTMLElement | null;
    if (!el) return;
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    };
    const leave = () => setDragOver(false);
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void add(files);
    };
    el.addEventListener('dragover', over);
    el.addEventListener('dragleave', leave);
    el.addEventListener('drop', drop);
    return () => {
      el.removeEventListener('dragover', over);
      el.removeEventListener('dragleave', leave);
      el.removeEventListener('drop', drop);
    };
  });

  return (
    <Screen title="名刺を取り込む" testID="screen-scan">
      <Row style={{ marginBottom: space.md }}>
        <Badge label={`現在のキュー ${inSession}/${MAX_SESSION_ITEMS}`} tone={inSession ? 'info' : 'neutral'} />
        {state.ocrRunning ? <Badge label="読み取り処理中" tone="info" /> : null}
      </Row>
      {messages.map((m, i) => (
        <Banner key={i} tone={m.tone} testID={`scan-message-${i}`}>
          {m.text}
        </Banner>
      ))}
      <View style={desktop ? { flexDirection: 'row', gap: space.lg } : { gap: space.lg }}>
        <Card style={{ flex: 1 }}>
          <T variant="heading">スマートフォンで撮影</T>
          <Button label="カメラで撮影" icon="📷" onPress={() => add('camera')} busy={busy} testID="capture-camera" />
        </Card>
        <View ref={dropRef as never} style={[styles.drop, dragOver && styles.dropOver, { flex: 1 }]} testID="drop-zone">
          <T variant="heading">画像・PDFを選択</T>
          <T variant="muted">画像・PDF（ドラッグ＆ドロップ可）</T>
          <Button label="ファイルを選ぶ" kind="secondary" onPress={() => add('files')} busy={busy} testID="pick-files" />
          <Text style={styles.dropHint}>{dragOver ? 'ここにドロップ' : ''}</Text>
        </View>
      </View>
      <Row style={{ marginTop: space.lg }}>
        <Button label={`取込キューを見る（${inSession}件）`} onPress={() => router.push('/scan/queue')} disabled={!inSession} testID="open-queue" />
        <Button label="手入力で登録" kind="secondary" onPress={() => router.push({ pathname: '/scan/review', params: { manual: '1' } })} testID="manual-entry" />
      </Row>
    </Screen>
  );
}

const styles = StyleSheet.create({
  drop: { borderWidth: 2, borderStyle: 'dashed', borderColor: color.line, borderRadius: 14, padding: space.lg, gap: space.sm, backgroundColor: color.white },
  dropOver: { borderColor: color.primary, backgroundColor: color.primaryTint },
  dropHint: { color: color.primary, fontWeight: '700', minHeight: 20 },
});
