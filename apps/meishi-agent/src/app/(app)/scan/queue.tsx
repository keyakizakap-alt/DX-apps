// S05 取込キュー: per-row status, resume after interruption, retry of failed rows only.
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import type { ScanStatus } from '../../../core/domain/schemas';
import { activeItems, removeItem, retryItem } from '../../../core/scan/queue';
import { useApp, useAppState, useVault } from '../../../ui/app-context';
import { Badge, Banner, Button, EmptyState, Row, Screen, T, type Tone } from '../../../ui/components';
import { color, space } from '../../../ui/theme';

const STATUS: Record<ScanStatus, { label: string; tone: Tone }> = {
  captured: { label: '撮影済み', tone: 'neutral' },
  queued: { label: '認識待ち', tone: 'neutral' },
  recognizing: { label: '認識中', tone: 'info' },
  needs_review: { label: '要確認', tone: 'warn' },
  done: { label: '完了', tone: 'ok' },
  failed: { label: '失敗', tone: 'danger' },
};

export default function Queue() {
  const app = useApp();
  const state = useAppState();
  const session = useVault();
  const router = useRouter();
  const items = activeItems(session);
  const ready = items.filter((i) => i.status === 'needs_review');
  const waiting = items.filter((i) => i.status === 'queued' || i.status === 'recognizing').length;

  return (
    <Screen title="取込キュー" subtitle={`${items.length}件（要確認 ${ready.length}・認識待ち ${waiting}・失敗 ${items.filter((i) => i.status === 'failed').length}）`} back="/scan" testID="screen-queue"
      actions={<Button label={ready.length ? `要確認へ進む（${ready.length}件）` : '要確認へ進む'} disabled={!ready.length} onPress={() => router.push({ pathname: '/scan/review', params: { item: ready[0]!.id } })} testID="go-review" />}>
      {waiting > 0 && !state.ocrRunning ? (
        <Banner tone="warn" title="読み取りが停止しています" action={<Button label="再開する" compact onPress={() => app.startQueue()} testID="resume-queue" />}>
        </Banner>
      ) : null}
      {state.ocrRunning ? <Badge label="読み取り中" tone="info" /> : null}
      {items.length === 0 ? (
        <EmptyState title="キューは空です" body="取り込んだ名刺はすべて処理済みです。" action={<Button label="名刺を取り込む" onPress={() => router.push('/scan')} />} testID="queue-empty" />
      ) : (
        <View style={{ gap: space.sm }} accessibilityRole="list">
          {items.map((item) => (
            <View key={item.id} style={s.row} testID={`queue-row-${item.index}`}>
              <View style={{ flex: 1, minWidth: 180 }}>
                <T style={{ fontWeight: '700' }}>名刺 #{String(item.index + 1).padStart(3, '0')}</T>
                <T variant="muted" numberOfLines={1}>
                  {item.status === 'failed' ? item.error ?? '失敗' : item.sourceName ?? (item.ocrLines?.length ? `${item.ocrLines.length}行を認識` : '')}
                </T>
              </View>
              <Badge label={STATUS[item.status].label} tone={STATUS[item.status].tone} testID={`queue-status-${item.index}`} />
              <Row wrap>
                {item.status === 'needs_review' ? <Button label="確認する" compact onPress={() => router.push({ pathname: '/scan/review', params: { item: item.id } })} /> : null}
                {item.status === 'failed' ? (
                  <>
                    <Button label="再試行" compact kind="secondary" onPress={async () => { await retryItem(session, item.id); app.startQueue(); }} testID={`retry-${item.index}`} />
                    <Button label="手入力" compact kind="ghost" onPress={() => router.push({ pathname: '/scan/review', params: { item: item.id } })} />
                  </>
                ) : null}
                <Button label="削除" compact kind="ghost" onPress={() => removeItem(session, item.id)} accessibilityHint="この名刺をキューから取り除きます" />
              </Row>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap', padding: space.md, backgroundColor: color.white, borderWidth: 1, borderColor: color.line, borderRadius: 10 },
});
