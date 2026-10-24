// S03 ホーム: counts, primary actions, recent encounters, follow-ups, measured sync state.
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { computeDuplicatePairs } from '../../core/ai/gateway';
import { loadDemoData } from '../../core/demo/fixtures';
import { suggestFollowUps } from '../../core/domain/followup';
import { activeItems } from '../../core/scan/queue';
import { useAppState, useVault } from '../../ui/app-context';
import { Avatar, Banner, Button, Card, EmptyState, Row, Screen, Section, T } from '../../ui/components';
import { cap99 } from '../../ui/status';
import { color, DESKTOP_MIN_WIDTH, elevation, numeric, space } from '../../ui/theme';

const DEMO_ENABLED = process.env.EXPO_PUBLIC_ENABLE_DEMO === '1';
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function Home() {
  const state = useAppState();
  const session = useVault();
  const router = useRouter();
  const desktop = useWindowDimensions().width >= DESKTOP_MIN_WIDTH;
  const snapshot = session.snapshot;
  const data = useMemo(() => {
    const index = session.index;
    const queue = activeItems(session);
    return {
      contacts: index.contacts.length,
      review: index.contacts.filter((c) => c.status !== 'confirmed').length + session.all('card').filter((c) => !c.contactId).length + queue.filter((i) => i.status === 'needs_review').length,
      duplicates: computeDuplicatePairs(session).filter((p) => p.candidate.strength !== 'weak').length,
      followups: suggestFollowUps(index, ymd(new Date()), 5),
      queue: queue.length,
      failed: queue.filter((i) => i.status === 'failed').length,
      recent: [...index.views.values()].filter((v) => v.lastMetAt).sort((a, b) => (b.lastMetAt ?? '').localeCompare(a.lastMetAt ?? '')).slice(0, 5),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, snapshot]);

  return (
    <Screen title="ホーム" testID="screen-home">
      {state.sync.status === 'error' || state.sync.status === 'auth_expired' ? (
        <Banner tone="warn" title="同期できていません" action={<Button label="同期画面を開く" compact kind="secondary" onPress={() => router.push('/settings/sync')} />}>
          {`${state.sync.lastError ?? ''} 端末内の変更（${state.sync.pending}件）は保存されています。`}
        </Banner>
      ) : null}
      {data.queue > 0 ? (
        <Banner tone="info" title={`取り込み中の名刺 ${data.queue}件`} action={<Button label="取込キューを開く" compact kind="secondary" onPress={() => router.push('/scan/queue')} />}>
          {data.failed ? `${data.failed}件が失敗しています。対象の行だけ再試行できます。` : '中断しても続きから再開できます。'}
        </Banner>
      ) : null}

      <View style={[s.kpis, desktop && { flexWrap: 'nowrap' }]}>
        <Kpi label="登録済み" accent={color.primary} value={data.contacts} onPress={() => router.push('/people')} testID="kpi-contacts" />
        <Kpi label="要確認" accent={color.warn} value={data.review} tone="warn" onPress={() => router.push({ pathname: '/people', params: { status: 'needs_review' } })} testID="kpi-review" />
        <Kpi label="重複候補" accent="#55307A" value={data.duplicates} onPress={() => router.push('/duplicates')} testID="kpi-duplicates" />
        <Kpi label="フォロー候補" accent={color.ok} value={data.followups.length} onPress={() => router.push({ pathname: '/assistant', params: { q: 'フォローすべき人' } })} testID="kpi-followups" />
      </View>

      <Row style={{ marginVertical: space.lg }}>
        <Button label="名刺を取り込む" icon="＋" onPress={() => router.push('/scan')} testID="cta-scan" />
        <Button label="要確認を処理" kind="secondary" onPress={() => router.push(data.queue ? '/scan/queue' : { pathname: '/people', params: { status: 'needs_review' } })} />
        <Button label="人物を探す" kind="secondary" onPress={() => router.push({ pathname: '/people', params: { focus: '1' } })} />
      </Row>

      {data.contacts === 0 ? (
        <Card>
          <EmptyState
            title="名刺はまだありません"
            action={
              <Row>
                <Button label="名刺を取り込む" onPress={() => router.push('/scan')} />
                <Button label="手入力で登録" kind="secondary" onPress={() => router.push({ pathname: '/scan/review', params: { manual: '1' } })} />
              </Row>
            }
            testID="home-empty"
          />
          {DEMO_ENABLED ? (
            <Banner tone="neutral" title="DEMO（開発用）" action={<Button label="架空データを読み込む" kind="secondary" compact testID="load-demo" onPress={async () => { await loadDemoData(session); }} />}>
              テスト専用の架空の名刺9件を追加します。実在の人物・会社ではありません。
            </Banner>
          ) : null}
        </Card>
      ) : (
        <View style={desktop ? s.twoCol : undefined}>
          <View style={desktop ? s.col : undefined}>
            <Section title="最近の出会い">
              {data.recent.length === 0 ? <T variant="muted">まだありません</T> : null}
              {data.recent.map((v) => (
                <Pressable key={v.contact.id} accessibilityRole="link" onPress={() => router.push(`/people/${v.contact.id}`)} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [s.row, hovered && s.rowHover]}>
                  <Avatar name={v.contact.fullName} id={v.contact.id} />
                  <View style={{ flex: 1 }}>
                    <T style={{ fontWeight: '700' }}>{v.contact.fullName}</T>
                    <T variant="muted" numberOfLines={1}>
                      {[v.current?.organization?.name, v.encounters[0]?.event].filter(Boolean).join(' ・ ')}
                    </T>
                  </View>
                  <T variant="small" style={[s.date, numeric]}>{v.lastMetAt}</T>
                </Pressable>
              ))}
            </Section>
          </View>
          <View style={desktop ? s.col : undefined}>
            <Section title="フォロー候補">
              {data.followups.length === 0 ? <T variant="muted">ありません</T> : null}
              {data.followups.map((f) => {
                const v = session.index.views.get(f.contactId);
                return v ? (
                  <Pressable key={f.contactId} accessibilityRole="link" onPress={() => router.push(`/people/${f.contactId}`)} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [s.row, hovered && s.rowHover]}>
                    <Avatar name={v.contact.fullName} id={v.contact.id} />
                    <View style={{ flex: 1 }}>
                      <T style={{ fontWeight: '700' }}>{v.contact.fullName}</T>
                      <T variant="muted">{f.reason}</T>
                    </View>
                  </Pressable>
                ) : null;
              })}
            </Section>
          </View>
        </View>
      )}
    </Screen>
  );
}

function Kpi({ label, accent, value, tone, onPress, testID }: { label: string; accent: string; value: number; tone?: 'warn'; onPress: () => void; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${value}件`} onPress={onPress} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [s.kpi, hovered && s.kpiHover]} testID={testID}>
      <View style={[s.kpiAccent, { backgroundColor: accent }]} />
      <T variant="label">{label}</T>
      <T variant="big" style={tone === 'warn' && value > 0 ? { color: color.warn } : undefined}>
        {cap99(value)}
      </T>
    </Pressable>
  );
}

const s = StyleSheet.create({
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  kpi: { flexGrow: 1, flexBasis: 150, minHeight: 112, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, borderRadius: 14, paddingVertical: space.lg, paddingHorizontal: 20, gap: 2, overflow: 'hidden', ...elevation.card },
  kpiHover: { borderColor: color.lineStrong, ...elevation.raised },
  kpiAccent: { position: 'absolute', left: 0, top: 0, right: 0, height: 3 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, borderRadius: 12, ...elevation.card },
  rowHover: { borderColor: color.lineStrong },
  date: { color: color.muted, backgroundColor: color.surfaceMuted, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, borderWidth: 1, borderColor: color.line, overflow: 'hidden' },
  twoCol: { flexDirection: 'row', gap: space.xl },
  col: { flex: 1 },
});
