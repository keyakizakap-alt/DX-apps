// S07 重複比較: reasons for each candidate pair; merge only after an explicit, confirmed choice.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { computeDuplicatePairs } from '../../core/ai/gateway';
import { decideDuplicate, mergeContacts } from '../../core/people';
import type { ContactView } from '../../core/domain/views';
import { useVault } from '../../ui/app-context';
import { Badge, Banner, Button, Card, EmptyState, KeyValue, Row, Screen, T } from '../../ui/components';
import { color, DESKTOP_MIN_WIDTH, space } from '../../ui/theme';

export default function Duplicates() {
  const session = useVault();
  const router = useRouter();
  const desktop = useWindowDimensions().width >= DESKTOP_MIN_WIDTH;
  const [confirm, setConfirm] = useState<{ keep: string; merge: string } | null>(null);
  const pairs = computeDuplicatePairs(session);
  void session.snapshot;

  return (
    <Screen title="重複候補" back testID="screen-duplicates">
      {pairs.length === 0 ? <EmptyState title="重複候補はありません" testID="duplicates-empty" /> : null}
      {pairs.map((p) => {
        const a = session.index.views.get(p.a.id)!;
        const b = session.index.views.get(p.b.id)!;
        const key = `${p.a.id}|${p.b.id}`;
        return (
          <Card key={key} style={{ marginBottom: space.lg }} testID="duplicate-pair">
            <Row>
              <Badge label={p.candidate.strength === 'strong' ? '一致度: 高' : p.candidate.strength === 'possible' ? '一致度: 中' : '一致度: 低'} tone={p.candidate.strength === 'strong' ? 'warn' : 'neutral'} />
              <T variant="muted">スコア {Math.round(p.candidate.score * 100)}</T>
            </Row>
            {p.candidate.reasons.map((r) => (
              <T key={r.kind} variant="small">・{r.label}</T>
            ))}
            <View style={desktop ? { flexDirection: 'row', gap: space.lg } : { gap: space.md }}>
              <Side view={a} label="A" />
              <Side view={b} label="B" />
            </View>
            {confirm && confirm.keep + confirm.merge === p.a.id + p.b.id || confirm && confirm.keep + confirm.merge === p.b.id + p.a.id ? (
              <Banner tone="warn" title="統合の確認" action={
                <>
                  <Button label="統合する" kind="danger" testID="confirm-merge" onPress={async () => { await mergeContacts(session, confirm.keep, confirm.merge); setConfirm(null); router.push(`/people/${confirm.keep}`); }} />
                  <Button label="やめる" kind="secondary" onPress={() => setConfirm(null)} />
                </>
              }>
                {`「${session.index.views.get(confirm.merge)?.contact.fullName}」の名刺・出会い・所属を「${session.index.views.get(confirm.keep)?.contact.fullName}」にまとめます。以前の所属は履歴として残ります。`}
              </Banner>
            ) : (
              <Row>
                <Button label="同じ人物（Aにまとめる）" kind="secondary" compact onPress={() => setConfirm({ keep: p.a.id, merge: p.b.id })} testID="merge-into-a" />
                <Button label="同じ人物（Bにまとめる）" kind="secondary" compact onPress={() => setConfirm({ keep: p.b.id, merge: p.a.id })} />
                <Button label="別人" compact onPress={() => decideDuplicate(session, p.a.id, p.b.id, 'different')} testID="mark-different" />
                <Button label="後で判断" kind="ghost" compact onPress={() => decideDuplicate(session, p.a.id, p.b.id, 'later')} />
              </Row>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}

function Side({ view, label }: { view: ContactView; label: string }) {
  return (
    <View style={s.side}>
      <T variant="label">{label}</T>
      <T variant="heading">{view.contact.fullName}</T>
      <KeyValue label="会社・役職" value={[view.current?.organization?.name, view.current?.affiliation.title].filter(Boolean).join(' ・ ')} />
      <KeyValue label="メール" value={view.contact.emails.join(', ')} />
      <KeyValue label="電話" value={view.contact.phones.map((p) => p.value).join(', ')} />
      <KeyValue label="交換日 / 最終面会" value={[view.cards[0]?.exchangedAt, view.lastMetAt].filter(Boolean).join(' / ')} />
      <KeyValue label="所属履歴" value={view.history.map((h) => `${h.organization?.name ?? ''}${h.affiliation.current ? '（現在）' : ''}`).join(' → ')} />
    </View>
  );
}

const s = StyleSheet.create({ side: { flex: 1, padding: space.md, borderRadius: 10, backgroundColor: color.bg } });
