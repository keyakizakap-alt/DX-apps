// S08 人物一覧・検索: on-device search across name/company/memo/event/tag; PC = table + filters
// on the left and a detail preview; phone = cards with a filter sheet.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { searchContacts, type SearchFilters } from '../../../core/domain/search';
import type { ReviewStatus } from '../../../core/domain/schemas';
import { useVault } from '../../../ui/app-context';
import { Avatar, Badge, Button, Chip, EmptyState, Row, Screen, T } from '../../../ui/components';
import { PersonDetail } from '../../../ui/person-detail';
import { STATUS_LABEL, STATUS_TONE } from '../../../ui/status';
import { color, DESKTOP_MIN_WIDTH, elevation, font, numeric, space } from '../../../ui/theme';

export default function People() {
  const params = useLocalSearchParams<{ focus?: string; status?: ReviewStatus; tag?: string; q?: string }>();
  const session = useVault();
  const router = useRouter();
  const desktop = useWindowDimensions().width >= DESKTOP_MIN_WIDTH;
  const [text, setText] = useState(params.q ?? '');
  const [status, setStatus] = useState<ReviewStatus | undefined>(params.status);
  const [tag, setTag] = useState<string | undefined>(params.tag);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<string | undefined>();
  const input = useRef<{ focus(): void } | null>(null);
  useEffect(() => {
    if (params.focus === '1') setTimeout(() => input.current?.focus(), 50);
  }, [params.focus]);
  const [statusParam, setStatusParam] = useState(params.status);
  if (statusParam !== params.status) {
    setStatusParam(params.status);
    setStatus(params.status);
  }

  const snapshot = session.snapshot; // changes whenever decrypted data changes
  const hits = useMemo(() => {
    void snapshot;
    const filters: SearchFilters = { text: text || undefined, status, tag };
    return searchContacts(session.index, filters);
  }, [session, snapshot, text, status, tag]);
  const tags = useMemo(() => {
    void snapshot;
    return [...new Set(session.all('contact').flatMap((c) => c.tags))].sort();
  }, [session, snapshot]);
  const unattachedCards = session.all('card').filter((c) => !c.contactId);
  const active = Boolean(text || status || tag);

  const filterPanel = (
    <View style={{ gap: space.sm }}>
      <T variant="label">確認状態</T>
      <Row>
        {(['needs_review', 'on_hold', 'confirmed'] as const).map((s) => (
          <Chip key={s} label={STATUS_LABEL[s]} selected={status === s} onPress={() => setStatus(status === s ? undefined : s)} testID={`filter-${s}`} />
        ))}
      </Row>
      {tags.length ? <T variant="label">タグ</T> : null}
      <Row>
        {tags.map((t) => (
          <Chip key={t} label={`#${t}`} selected={tag === t} onPress={() => setTag(tag === t ? undefined : t)} />
        ))}
      </Row>
      {active ? <Button label="条件をすべて解除" kind="ghost" compact onPress={() => { setText(''); setStatus(undefined); setTag(undefined); }} testID="clear-filters" /> : null}
    </View>
  );

  const searchBox = (
    <View style={s.searchRow}>
      <TextInput
        ref={input as never}
        value={text}
        onChangeText={setText}
        placeholder="名前・会社・イベント・会話メモ・タグで検索（/ で移動）"
        accessibilityLabel="人物を検索"
        testID="people-search"
        style={s.search}
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
    </View>
  );

  const empty = (
    <EmptyState
      title={active ? '条件に合う人物が見つかりません' : 'まだ人物が登録されていません'}
      body={active ? '検索語を減らすか、絞り込みを解除してください。' : '名刺を取り込むと、ここに表示されます。'}
      action={active ? <Button label="条件を解除" kind="secondary" onPress={() => { setText(''); setStatus(undefined); setTag(undefined); }} /> : <Button label="名刺を取り込む" onPress={() => router.push('/scan')} />}
      testID="people-empty"
    />
  );

  return (
    <Screen title="人物一覧" subtitle={`検索結果 ${hits.length}件 ・ 検索は端末内で行い、サーバーには送信しません`} testID="screen-people" scroll={!desktop}
      actions={<Button label="＋ 取り込み" compact onPress={() => router.push('/scan')} />}>
      {unattachedCards.length ? (
        <Pressable onPress={() => router.push({ pathname: '/scan/review', params: { card: unattachedCards[0]!.id } })} accessibilityRole="button" style={s.held}>
          <T>保留中の名刺が {unattachedCards.length} 件あります → 確認する</T>
        </Pressable>
      ) : null}
      {searchBox}
      {desktop ? (
        <View style={s.desktopBody}>
          <View style={s.filters}>{filterPanel}</View>
          <View style={s.table} accessibilityRole="list">
            <View style={[s.tr, s.th]}>
              <T style={[s.c1, s.thText]}>氏名・会社</T>
              <T style={[s.c4, s.thText]}>最終面会</T>
              <T style={[s.c5, s.thText]}>状態</T>
            </View>
            <FlatList
              data={hits}
              keyExtractor={(h) => h.view.contact.id}
              ListEmptyComponent={empty}
              initialNumToRender={40}
              windowSize={10}
              renderItem={({ item: h }) => (
                <Pressable accessibilityRole="button" accessibilityLabel={`${h.view.contact.fullName} ${h.view.current?.organization?.name ?? ''}`} onPress={() => setSelected(h.view.contact.id)} onLongPress={() => router.push(`/people/${h.view.contact.id}`)} style={[s.tr, selected === h.view.contact.id && s.trOn]} testID="people-row">
                  <View style={[s.c1, s.nameCell]}>
                    <Avatar name={h.view.contact.fullName} id={h.view.contact.id} size={34} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T style={s.name} numberOfLines={1}>{h.view.contact.fullName}</T>
                      <T variant="small" style={s.org} numberOfLines={1}>{[h.view.current?.organization?.name, h.view.current?.affiliation.title].filter(Boolean).join(' ・ ') || '—'}</T>
                    </View>
                  </View>
                  <T style={[s.c4, numeric]} numberOfLines={1}>{h.view.lastMetAt ?? '—'}</T>
                  <View style={s.c5}><Badge label={STATUS_LABEL[h.view.contact.status]} tone={STATUS_TONE[h.view.contact.status]} /></View>
                </Pressable>
              )}
            />
          </View>
          <View style={s.detail}>
            {selected && session.index.views.get(selected) ? <PersonDetail id={selected} compact /> : <EmptyState title="人物を選択" body="一覧から選ぶと詳細を表示します。" />}
          </View>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <Button label={showFilters ? '絞り込みを閉じる' : `絞り込み${active ? '（適用中）' : ''}`} kind="secondary" compact onPress={() => setShowFilters(!showFilters)} testID="toggle-filters" />
          {showFilters ? <View style={s.sheet}>{filterPanel}</View> : null}
          {hits.length === 0 ? empty : null}
          {hits.map((h) => (
            <Pressable key={h.view.contact.id} accessibilityRole="link" onPress={() => router.push(`/people/${h.view.contact.id}`)} style={s.card} testID="people-card">
              <Avatar name={h.view.contact.fullName} id={h.view.contact.id} size={44} />
              <View style={{ flex: 1 }}>
                <T style={{ fontWeight: '700', fontSize: 17 }}>{h.view.contact.fullName}</T>
                <T variant="muted" numberOfLines={1}>{[h.view.current?.organization?.name, h.view.current?.affiliation.title].filter(Boolean).join(' ・ ')}</T>
                {h.view.lastMetAt ? <T variant="small">最終面会 {h.view.lastMetAt}{h.view.encounters[0]?.event ? `（${h.view.encounters[0].event}）` : ''}</T> : null}
              </View>
              <Badge label={STATUS_LABEL[h.view.contact.status]} tone={STATUS_TONE[h.view.contact.status]} />
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  searchRow: { marginBottom: space.lg },
  search: { minHeight: 52, borderWidth: 1, borderColor: color.lineStrong, borderRadius: 12, paddingHorizontal: space.lg, fontSize: font.body, backgroundColor: color.surface, color: color.ink, fontFamily: font.family, ...elevation.card },
  desktopBody: { flex: 1, flexDirection: 'row', gap: space.lg, minHeight: 520 },
  filters: { width: 176 },
  table: { flex: 1.6, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, borderRadius: 14, overflow: 'hidden', ...elevation.card },
  detail: { flex: 1, minWidth: 300, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, borderRadius: 14, padding: space.lg, ...elevation.card },
  tr: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: space.lg, borderBottomWidth: 1, borderBottomColor: '#EFEDE6', gap: space.sm },
  trOn: { backgroundColor: color.primaryTint, borderLeftWidth: 3, borderLeftColor: color.primary, paddingLeft: space.lg - 3 },
  th: { backgroundColor: color.surfaceMuted, minHeight: 40 },
  thText: { fontWeight: '700', fontSize: 12, color: color.muted, letterSpacing: 0.6 },
  nameCell: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { fontWeight: '700', flexShrink: 1 },
  c1: { flex: 1, minWidth: 0 },
  org: { color: color.muted },
  c4: { width: 96, flexShrink: 0, fontSize: 14, color: color.muted },
  c5: { width: 92, flexShrink: 0 },
  sheet: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, borderRadius: 14, padding: space.md },
  card: { flexDirection: 'row', gap: space.md, alignItems: 'center', backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, borderRadius: 14, padding: space.lg, minHeight: 72, ...elevation.card },
  held: { padding: space.md, borderRadius: 10, backgroundColor: color.warnBg, borderLeftWidth: 4, borderLeftColor: color.warn, marginBottom: space.md },
});
