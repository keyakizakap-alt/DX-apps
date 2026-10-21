// S09 人物詳細 body. Shows the origin of each value (OCR / 手入力 / AI候補) and keeps past affiliations.
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { deleteContact } from '../core/people';
import type { CardField } from '../core/domain/schemas';
import { useVault } from './app-context';
import { CardImage } from './card-image';
import { Badge, Banner, Button, Field, KeyValue, Row, Section, T } from './components';
import { STATUS_LABEL, STATUS_TONE } from './status';
import { color, MIN_TAP, space } from './theme';

const SOURCE: Record<CardField['source'], string> = { ocr: 'OCR', user: '手入力', ai_suggestion: 'AI候補' };
const FIELD_LABEL: Record<string, string> = { fullName: '氏名', fullNameKana: 'よみ', company: '会社', department: '部署', title: '役職', email: 'メール', phone: '電話', mobile: '携帯', fax: 'FAX', address: '住所', url: 'URL' };

export function PersonDetail({ id, compact }: { id: string; compact?: boolean }) {
  const session = useVault();
  const router = useRouter();
  const view = session.index.views.get(id);
  const [copied, setCopied] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');
  const [newTask, setNewTask] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!view) return <Banner tone="warn">この人物は見つかりません（削除または統合された可能性があります）。</Banner>;
  const c = view.contact;

  const copy = async (value: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(value);
  };
  const addTag = async () => {
    const t = newTag.trim().replace(/^#/, '');
    if (!t || c.tags.includes(t)) return;
    await session.commit([{ ...c, tags: [...c.tags, t] }], { action: 'record.update' });
    setNewTag('');
  };
  const removeTag = (t: string) => session.commit([{ ...c, tags: c.tags.filter((x) => x !== t) }], { action: 'record.update' });

  return (
    <View style={{ gap: space.md }} testID="person-detail">
      <View>
        <Row>
          <T variant="title" role="heading" testID="person-name">{c.fullName}</T>
          <Badge label={STATUS_LABEL[c.status]} tone={STATUS_TONE[c.status]} />
        </Row>
        {c.fullNameKana ? <T variant="muted">{c.fullNameKana}</T> : null}
        <T>{[view.current?.organization?.name, view.current?.affiliation.department, view.current?.affiliation.title].filter(Boolean).join(' ・ ') || '所属未登録'}</T>
      </View>
      <Row>
        <Button label="出会いのメモ" compact onPress={() => router.push(`/people/${id}/encounter`)} testID="add-encounter" />
        <Button label="フォロー文を作る" compact kind="secondary" onPress={() => router.push({ pathname: '/assistant', params: { contact: id } })} testID="make-draft" />
        <Button label="情報を修正" compact kind="secondary" onPress={() => router.push(`/people/${id}/edit`)} testID="edit-person" />
        {compact ? <Button label="詳細ページ" compact kind="ghost" onPress={() => router.push(`/people/${id}`)} /> : null}
        {c.status !== 'confirmed' ? <Button label="確認済みにする" compact kind="ghost" onPress={() => session.commit([{ ...c, status: 'confirmed' }], { action: 'record.update' })} testID="mark-confirmed" /> : null}
      </Row>

      <Section title="連絡先">
        {copied ? <Banner tone="warn">コピーしました。共有端末ではクリップボードに残る点に注意してください。</Banner> : null}
        {c.emails.length === 0 && c.phones.length === 0 ? <T variant="muted">連絡先は未登録です。</T> : null}
        {c.emails.map((e) => (
          <ContactRow key={e} label="メール" value={e} onCopy={() => copy(e)} />
        ))}
        {c.phones.map((p) => (
          <ContactRow key={p.value} label={{ office: '電話', mobile: '携帯', fax: 'FAX', other: '電話' }[p.kind]} value={p.value} onCopy={() => copy(p.value)} />
        ))}
      </Section>

      <Section title="タグ">
        <Row>
          {c.tags.map((t) => (
            <Pressable key={t} accessibilityRole="button" accessibilityLabel={`タグ ${t} を外す`} onPress={() => removeTag(t)} style={s.tag}>
              <T variant="small">#{t} ×</T>
            </Pressable>
          ))}
        </Row>
        <Row wrap={false}>
          <View style={{ flex: 1 }}>
            <Field label="タグを追加" value={newTag} onChangeText={setNewTag} onSubmitEditing={addTag} maxLength={30} testID="new-tag" />
          </View>
          <Button label="追加" compact kind="secondary" onPress={addTag} disabled={!newTag.trim()} />
        </Row>
      </Section>

      <Section title={`出会いの記録（${view.encounters.length}）`}>
        {view.encounters.length === 0 ? <T variant="muted">まだ記録がありません。「出会いのメモ」から追加できます。</T> : null}
        {view.encounters.map((e) => (
          <Pressable key={e.id} accessibilityRole="button" onPress={() => router.push({ pathname: `/people/${id}/encounter`, params: { encounterId: e.id } })} style={s.item} testID="encounter-row">
            <Row>
              <T style={{ fontWeight: '700' }}>{e.date}</T>
              {e.event ? <T>{e.event}</T> : null}
              <Badge label={{ confirmed: '本人メモ・確実', memo: 'メモ', uncertain: '不確か' }[e.certainty]} tone="neutral" />
            </Row>
            {e.conversation ? <T variant="muted">{e.conversation}</T> : null}
            {e.nextAction ? <T variant="small">次の行動: {e.nextAction}</T> : null}
          </Pressable>
        ))}
      </Section>

      <Section title="フォロー予定">
        {view.tasks.map((t) => (
          <Row key={t.id}>
            <Pressable role="checkbox" aria-checked={t.done} accessibilityRole="checkbox" accessibilityState={{ checked: t.done }} accessibilityLabel={`${t.title} を完了にする`} onPress={() => session.commit([{ ...t, done: !t.done }], { action: 'record.update' })} style={[s.check, t.done && { backgroundColor: color.ok }]}>
              <T style={{ color: t.done ? color.white : color.ink }}>{t.done ? '✓' : ''}</T>
            </Pressable>
            <T style={t.done ? { textDecorationLine: 'line-through', color: color.muted } : undefined}>{t.title}</T>
            {t.dueDate ? <T variant="small">期限 {t.dueDate}</T> : null}
          </Row>
        ))}
        <Row wrap={false}>
          <View style={{ flex: 1 }}>
            <Field label="フォロー予定を追加" value={newTask} onChangeText={setNewTask} maxLength={200} testID="new-task" />
          </View>
          <Button label="追加" compact kind="secondary" disabled={!newTask.trim()} onPress={async () => { await session.commit([session.build('followup', { contactId: id, title: newTask.trim(), done: false, source: 'user' })], { action: 'record.create' }); setNewTask(''); }} />
        </Row>
      </Section>

      <Section title="所属履歴">
        {view.history.length === 0 ? <T variant="muted">所属は未登録です。</T> : null}
        {view.history.map((h) => (
          <View key={h.affiliation.id} style={s.item}>
            <Row>
              <T style={{ fontWeight: '700' }}>{h.organization?.name ?? '（会社不明）'}</T>
              <Badge label={h.affiliation.current ? '現在' : '過去'} tone={h.affiliation.current ? 'ok' : 'neutral'} />
            </Row>
            <T variant="muted">{[h.affiliation.department, h.affiliation.title, h.affiliation.observedAt && `確認日 ${h.affiliation.observedAt}`].filter(Boolean).join(' ・ ')}</T>
          </View>
        ))}
      </Section>

      <Section title={`名刺（${view.cards.length}）`}>
        {view.cards.map((card) => (
          <View key={card.id} style={s.item}>
            <Row>
              <T variant="small">交換日 {card.exchangedAt ?? '不明'}</T>
              <Badge label={card.ocrEngine === 'manual' ? '手入力' : card.ocrEngine === 'demo' ? 'DEMO' : '端末内OCR'} tone="neutral" />
              <Badge label={STATUS_LABEL[card.status]} tone={STATUS_TONE[card.status]} />
            </Row>
            {card.frontBlobId ? <CardImage blobId={card.frontBlobId} label="名刺の表面" height={compact ? 160 : 220} /> : null}
            {card.backBlobId ? <CardImage blobId={card.backBlobId} label="名刺の裏面" height={compact ? 160 : 220} /> : null}
            {card.fields.map((f, i) => (
              <Row key={`${f.key}-${i}`}>
                <T variant="small" style={{ width: 56, color: color.muted }}>{FIELD_LABEL[f.key] ?? f.key}</T>
                <T variant="small" style={{ flex: 1 }}>{f.value}</T>
                <Badge label={`${SOURCE[f.source]}${f.verified ? '・確認済み' : '・未確認'}`} tone={f.verified ? 'ok' : 'warn'} />
              </Row>
            ))}
          </View>
        ))}
      </Section>

      {c.note ? <KeyValue label="メモ" value={c.note} /> : null}
      <T variant="small" style={{ color: color.muted }}>更新日 {c.updatedAt.slice(0, 10)}</T>

      {confirmDelete ? (
        <Banner tone="danger" title="この人物を削除しますか？" action={
          <>
            <Button label="削除する" kind="danger" testID="confirm-delete-person" onPress={async () => { await deleteContact(session, id); router.replace('/people'); }} />
            <Button label="やめる" kind="secondary" onPress={() => setConfirmDelete(false)} />
          </>
        }>
          名刺画像・出会いの記録・所属履歴も削除されます。同期中の他の端末からも削除されます（オフラインの端末は次回の同期時）。
        </Banner>
      ) : (
        <Button label="この人物を削除" kind="ghost" compact onPress={() => setConfirmDelete(true)} testID="delete-person" />
      )}
    </View>
  );
}

function ContactRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <Row wrap={false} style={{ minHeight: MIN_TAP }}>
      <T variant="small" style={{ width: 56, color: color.muted }}>{label}</T>
      <T style={{ flex: 1 }} selectable>{value}</T>
      <Button label="コピー" kind="ghost" compact onPress={onCopy} accessibilityHint={`${label}をクリップボードにコピー`} />
    </Row>
  );
}

const s = StyleSheet.create({
  item: { padding: space.md, borderRadius: 10, borderWidth: 1, borderColor: color.line, backgroundColor: color.white, gap: 4 },
  tag: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: 999, backgroundColor: color.primaryTint },
  check: { width: MIN_TAP, height: MIN_TAP, borderRadius: 8, borderWidth: 1, borderColor: color.line, alignItems: 'center', justifyContent: 'center' },
});
