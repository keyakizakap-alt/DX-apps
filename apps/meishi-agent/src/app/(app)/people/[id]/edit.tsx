// 情報を修正: user corrections. Changing company/title records a new affiliation and keeps the old one.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { normalizeCompany } from '../../../../core/domain/normalize';
import { Contact, type Entity, type Phone } from '../../../../core/domain/schemas';
import { useVault } from '../../../../ui/app-context';
import { Banner, Button, Chip, Field, Row, Screen, T, Toggle } from '../../../../ui/components';
import { useLeaveGuard } from '../../../../ui/use-leave-guard';
import { space } from '../../../../ui/theme';

export default function EditPerson() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useVault();
  const router = useRouter();
  const view = session.index.views.get(id);
  const [form, setForm] = useState(() => ({
    fullName: view?.contact.fullName ?? '',
    fullNameKana: view?.contact.fullNameKana ?? '',
    emails: view?.contact.emails.join('\n') ?? '',
    phones: view?.contact.phones.map((p) => `${p.kind === 'mobile' ? '携帯' : p.kind === 'fax' ? 'FAX' : '電話'}: ${p.value}`).join('\n') ?? '',
    note: view?.contact.note ?? '',
    company: view?.current?.organization?.name ?? '',
    department: view?.current?.affiliation.department ?? '',
    title: view?.current?.affiliation.title ?? '',
    status: view?.contact.status ?? 'confirmed',
  }));
  const [asHistory, setAsHistory] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLeaveGuard(dirty);
  if (!view) return <Screen title="情報を修正" back="/people"><Banner tone="warn">人物が見つかりません。</Banner></Screen>;
  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const save = async () => {
    setError(null);
    const phones: Phone[] = form.phones.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const kind: Phone['kind'] = /^携帯/.test(l) ? 'mobile' : /^FAX/i.test(l) ? 'fax' : 'office';
      return { kind, value: l.replace(/^(携帯|FAX|電話)\s*[:：]\s*/i, '') };
    });
    const contact = { ...view.contact, fullName: form.fullName.trim(), fullNameKana: form.fullNameKana.trim() || undefined, emails: form.emails.split(/[\n,]/).map((e) => e.trim()).filter(Boolean), phones, note: form.note.trim() || undefined, status: form.status as Contact['status'] };
    const parsed = Contact.safeParse(contact);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message === 'Invalid email address' || parsed.error.issues[0]?.path.includes('emails') ? 'メールアドレスの形式を確認してください' : parsed.error.issues[0]?.message ?? '入力内容を確認してください');
    const changes: Entity[] = [parsed.data];
    const cur = view.current;
    const company = form.company.trim();
    const changed = company && (normalizeCompany(company) !== normalizeCompany(cur?.organization?.name) || form.title.trim() !== (cur?.affiliation.title ?? '') || form.department.trim() !== (cur?.affiliation.department ?? ''));
    if (changed) {
      let org = session.all('organization').find((o) => normalizeCompany(o.name) === normalizeCompany(company));
      if (!org) {
        org = session.build('organization', { name: company });
        changes.push(org);
      }
      if (cur && asHistory) {
        changes.push({ ...cur.affiliation, current: false });
        changes.push(session.build('affiliation', { contactId: id, organizationId: org.id, department: form.department.trim() || undefined, title: form.title.trim() || undefined, current: true, observedAt: new Date().toISOString().slice(0, 10) }));
      } else if (cur) {
        changes.push({ ...cur.affiliation, organizationId: org.id, department: form.department.trim() || undefined, title: form.title.trim() || undefined });
      } else {
        changes.push(session.build('affiliation', { contactId: id, organizationId: org.id, department: form.department.trim() || undefined, title: form.title.trim() || undefined, current: true }));
      }
    }
    await session.commit(changes, { action: 'record.update', count: 1 });
    setDirty(false);
    router.replace(`/people/${id}`);
  };

  return (
    <Screen title="情報を修正" subtitle="手で修正した値はOCRの元データと区別して保存されます" back={`/people/${id}`} narrow testID="screen-edit-person">
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Field label="氏名" value={form.fullName} onChangeText={set('fullName')} required testID="edit-name" maxLength={80} />
      <Field label="よみ / ローマ字" value={form.fullNameKana} onChangeText={set('fullNameKana')} maxLength={80} />
      <Field label="メール（1行に1件）" value={form.emails} onChangeText={set('emails')} multiline autoCapitalize="none" testID="edit-emails" />
      <Field label="電話（例: 携帯: 090-…）" value={form.phones} onChangeText={set('phones')} multiline />
      <T variant="heading" style={{ marginTop: space.md }}>現在の所属</T>
      <Field label="会社名" value={form.company} onChangeText={set('company')} maxLength={120} testID="edit-company" />
      <Field label="部署" value={form.department} onChangeText={set('department')} maxLength={120} />
      <Field label="役職" value={form.title} onChangeText={set('title')} maxLength={120} />
      <Toggle label="異動・転職として以前の所属を履歴に残す" description="オフにすると、現在の所属の誤りを訂正します（履歴は増えません）。" value={asHistory} onChange={setAsHistory} />
      <T variant="label" style={{ marginTop: space.md }}>確認状態</T>
      <Row style={{ marginVertical: space.sm }}>
        {(['confirmed', 'needs_review', 'on_hold'] as const).map((s) => (
          <Chip key={s} label={{ confirmed: '確認済み', needs_review: '要確認', on_hold: '保留' }[s]} selected={form.status === s} onPress={() => { setForm((f) => ({ ...f, status: s })); setDirty(true); }} />
        ))}
      </Row>
      <Field label="メモ" value={form.note} onChangeText={set('note')} multiline maxLength={4000} />
      <Button label="保存" onPress={save} testID="edit-save" />
    </Screen>
  );
}
