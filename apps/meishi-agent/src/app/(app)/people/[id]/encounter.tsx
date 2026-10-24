// S10 会った経緯: explicit 保存 (no autosave), confirmation before leaving with unsaved edits.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ZodError } from 'zod';
import type { Encounter } from '../../../../core/domain/schemas';
import { useVault } from '../../../../ui/app-context';
import { Banner, Button, Chip, Field, Row, Screen, T } from '../../../../ui/components';
import { useLeaveGuard } from '../../../../ui/use-leave-guard';
import { space } from '../../../../ui/theme';

const today = () => new Date().toISOString().slice(0, 10);

export default function EncounterEdit() {
  const { id, encounterId } = useLocalSearchParams<{ id: string; encounterId?: string }>();
  const session = useVault();
  const router = useRouter();
  const existing = encounterId ? session.get(encounterId, 'encounter') : undefined;
  const person = session.index.views.get(id)?.contact;
  const [form, setForm] = useState({
    date: existing?.date ?? today(),
    event: existing?.event ?? '',
    place: existing?.place ?? '',
    conversation: existing?.conversation ?? '',
    nextAction: existing?.nextAction ?? '',
    certainty: (existing?.certainty ?? 'memo') as Encounter['certainty'],
  });
  const [dirty, setDirty] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLeaveGuard(dirty);
  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  const back = () => (dirty ? setConfirmLeave(true) : router.replace(`/people/${id}`));

  if (!person) return <Screen title="出会いのメモ" back="/people"><Banner tone="warn">人物が見つかりません。</Banner></Screen>;

  const save = async () => {
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return setError('日付は 2026-10-21 の形式で入力してください');
    const fields = { contactId: id, date: form.date, event: form.event.trim() || undefined, place: form.place.trim() || undefined, conversation: form.conversation.trim() || undefined, nextAction: form.nextAction.trim() || undefined, certainty: form.certainty };
    try {
      await session.commit([existing ? { ...existing, ...fields } : session.build('encounter', fields)], { action: existing ? 'record.update' : 'record.create' });
      setDirty(false);
      router.replace(`/people/${id}`);
    } catch (e) {
      setError(e instanceof ZodError ? '入力内容を確認してください（文字数の上限を超えている可能性があります）' : '保存できませんでした');
    }
  };

  return (
    <Screen title={existing ? '出会いのメモを編集' : '出会いのメモを追加'} subtitle={`${person.fullName} さん`} narrow testID="screen-encounter"
      actions={<Button label="‹ 戻る" kind="ghost" compact onPress={back} testID="encounter-back" />}>
      {confirmLeave ? (
        <Banner tone="warn" title="保存していない変更があります" action={
          <>
            <Button label="破棄して戻る" kind="danger" compact onPress={() => { setDirty(false); router.replace(`/people/${id}`); }} testID="discard-changes" />
            <Button label="編集を続ける" kind="secondary" compact onPress={() => setConfirmLeave(false)} />
          </>
        }>
          変更を保存せずに戻ると、入力内容は失われます。
        </Banner>
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Field label="日付" value={form.date} onChangeText={set('date')} placeholder="2026-10-21" testID="enc-date" required />
      <Field label="イベント" value={form.event} onChangeText={set('event')} maxLength={120} testID="enc-event" />
      <Field label="場所" value={form.place} onChangeText={set('place')} maxLength={120} />
      <Field label="会話の内容" value={form.conversation} onChangeText={set('conversation')} multiline maxLength={4000} testID="enc-conversation" hint="この内容は暗号化して保存・同期されます。AIの外部送信は、送信前に確認画面で内容を確認した場合のみ行われます。" />
      <Field label="次の行動（フォロー予定）" value={form.nextAction} onChangeText={set('nextAction')} maxLength={400} testID="enc-next" />
      <T variant="label">記録の確かさ（本人メモ）</T>
      <Row style={{ marginVertical: space.sm }}>
        {(['confirmed', 'memo', 'uncertain'] as const).map((c) => (
          <Chip key={c} label={{ confirmed: '確実', memo: 'メモ', uncertain: '不確か' }[c]} selected={form.certainty === c} onPress={() => { setForm((f) => ({ ...f, certainty: c })); setDirty(true); }} />
        ))}
      </Row>
      <Row>
        <Button label="保存" onPress={save} testID="enc-save" />
        {existing ? <Button label="このメモを削除" kind="ghost" onPress={async () => { await session.remove([existing.id]); router.replace(`/people/${id}`); }} /> : null}
      </Row>
    </Screen>
  );
}
