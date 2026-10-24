// S13 競合: shows this device's version and the other device's version side by side; nothing is
// overwritten until the user chooses. "両方残す" is recommended where available.
import { useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import type { Entity } from '../../../core/domain/schemas';
import { useApp, useVault } from '../../../ui/app-context';
import { Badge, Banner, Button, Card, EmptyState, Row, Screen, T } from '../../../ui/components';
import { formatTime } from '../../../ui/status';
import { color, DESKTOP_MIN_WIDTH, space } from '../../../ui/theme';

const TYPE: Partial<Record<Entity['type'], string>> = { contact: '人物', encounter: '出会いのメモ', card: '名刺', affiliation: '所属', organization: '会社', followup: 'フォロー予定', tag: 'タグ', duplicateDecision: '重複の判断' };
const HIDDEN = new Set(['id', 'type', 'createdAt', 'updatedAt', 'version']);
const LABEL: Record<string, string> = {
  fullName: '氏名', fullNameKana: 'よみ', emails: 'メール', phones: '電話', tags: 'タグ', status: '確認状態', note: 'メモ', name: '名称', date: '日付', event: 'イベント', place: '場所',
  conversation: '会話', nextAction: '次の行動', certainty: '確かさ', department: '部署', title: '役職', current: '現在の所属', organizationId: '会社', fields: '名刺の項目', done: '完了', dueDate: '期限', decision: '判断',
};

function diff(a?: Entity, b?: Entity): string[] {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})].filter((k) => !HIDDEN.has(k)));
  return [...keys].filter((k) => JSON.stringify((a as Record<string, unknown> | undefined)?.[k]) !== JSON.stringify((b as Record<string, unknown> | undefined)?.[k]));
}
const show = (v: unknown) => (v === undefined ? '（なし）' : typeof v === 'string' ? v : JSON.stringify(v));

export default function Conflicts() {
  const app = useApp();
  const session = useVault();
  const desktop = useWindowDimensions().width >= DESKTOP_MIN_WIDTH;
  const conflicts = session.conflicts;
  const [remote, setRemote] = useState<Record<string, Entity | null>>({});
  const snapshot = session.snapshot;
  useEffect(() => {
    void snapshot;
    void (async () => {
      const out: Record<string, Entity | null> = {};
      for (const c of session.conflicts) out[c.id] = c.conflict?.envelope ? await session.decryptEnvelope(c.id, c.conflict.envelope).catch(() => null) : null;
      setRemote(out);
    })();
  }, [session, snapshot]);

  return (
    <Screen title="同期の競合" subtitle="採用する内容を選んでください" back="/settings/sync" testID="screen-conflicts">
      {conflicts.length === 0 ? <EmptyState title="競合はありません" testID="conflicts-empty" /> : null}
      {conflicts.map((c) => {
        const mine = session.getAny(c.id);
        const theirs = remote[c.id] ?? undefined;
        const fields = diff(mine, theirs);
        const canBoth = mine?.type === 'contact' || mine?.type === 'encounter';
        return (
          <Card key={c.id} style={{ marginBottom: space.lg }} testID="conflict-item">
            <Row>
              <Badge label={TYPE[(mine ?? theirs)?.type ?? 'contact'] ?? 'データ'} tone="neutral" />
              <T variant="small">検出 {formatTime(c.conflict!.detectedAt)}</T>
            </Row>
            {c.deleted || c.conflict?.deleted ? <Banner tone="warn">{c.deleted ? 'この端末では削除、別の端末では変更されています。' : '別の端末で削除されています。'}</Banner> : null}
            <View style={desktop ? { flexDirection: 'row', gap: space.lg } : { gap: space.md }}>
              <View style={{ flex: 1, padding: space.md, borderRadius: 10, backgroundColor: color.primaryTint }}>
                <T variant="label">この端末（{mine ? formatTime(mine.updatedAt) : '削除'}）</T>
                {fields.map((f) => <T key={f} variant="small">{LABEL[f] ?? f}: {show((mine as Record<string, unknown> | undefined)?.[f])}</T>)}
              </View>
              <View style={{ flex: 1, padding: space.md, borderRadius: 10, backgroundColor: color.warnBg }}>
                <T variant="label">別の端末（{theirs ? formatTime(theirs.updatedAt) : c.conflict?.deleted ? '削除' : '復号できません'}）</T>
                {fields.map((f) => <T key={f} variant="small">{LABEL[f] ?? f}: {show((theirs as Record<string, unknown> | undefined)?.[f])}</T>)}
              </View>
            </View>
            <Row>
              {canBoth ? <Button label="両方残す（推奨）" onPress={() => app.resolveConflict(c.id, 'keep_both')} testID="keep-both" /> : null}
              <Button label="この端末の内容を採用" kind="secondary" onPress={() => app.resolveConflict(c.id, 'keep_local')} testID="keep-local" />
              <Button label="別の端末の内容を採用" kind="secondary" onPress={() => app.resolveConflict(c.id, 'keep_remote')} testID="keep-remote" />
            </Row>
          </Card>
        );
      })}
    </Screen>
  );
}
