// S06 OCRレビュー (+ S07 duplicate decision before saving). OCR values are proposals: every field
// shows its source and confidence, and nothing is marked verified without a user action.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { findDuplicateCandidates } from '../../../core/domain/duplicates';
import { needsVerification } from '../../../core/domain/ocr-parse';
import type { BusinessCard, CardField, CardFieldKey, ScanItem } from '../../../core/domain/schemas';
import { activeItems } from '../../../core/scan/queue';
import { initialFields, ReviewValidationError, saveReviewedCard, type ReviewDecision } from '../../../core/scan/review';
import { useVault } from '../../../ui/app-context';
import { CardImage } from '../../../ui/card-image';
import { Badge, Banner, Button, Card, EmptyState, Row, Screen, T } from '../../../ui/components';
import { color, DESKTOP_MIN_WIDTH, font, MIN_TAP, space } from '../../../ui/theme';

const FIELD_ORDER: { key: CardFieldKey; label: string; required?: boolean; keyboard?: 'email-address' | 'phone-pad' | 'url' }[] = [
  { key: 'fullName', label: '氏名', required: true },
  { key: 'fullNameKana', label: 'よみ / ローマ字' },
  { key: 'company', label: '会社名', required: true },
  { key: 'department', label: '部署' },
  { key: 'title', label: '役職' },
  { key: 'email', label: 'メール', keyboard: 'email-address' },
  { key: 'phone', label: '電話（代表・固定）', keyboard: 'phone-pad' },
  { key: 'mobile', label: '携帯', keyboard: 'phone-pad' },
  { key: 'fax', label: 'FAX', keyboard: 'phone-pad' },
  { key: 'address', label: '住所' },
  { key: 'url', label: 'URL', keyboard: 'url' },
];

export default function Review() {
  const params = useLocalSearchParams<{ item?: string; card?: string; manual?: string }>();
  const session = useVault();
  const router = useRouter();
  const item = params.item ? session.get(params.item, 'scanItem') : undefined;
  const heldCard = params.card ? session.get(params.card, 'card') : undefined;
  if (!item && !heldCard && params.manual !== '1') {
    return (
      <Screen title="読み取り結果の確認" back="/scan/queue">
        <EmptyState title="確認する名刺が見つかりません" body="すでに保存済みか、キューから削除された可能性があります。" action={<Button label="取込キューへ" onPress={() => router.replace('/scan/queue')} />} />
      </Screen>
    );
  }
  // Remount per card so the form state starts from that card's OCR result.
  return <ReviewForm key={item?.id ?? heldCard?.id ?? 'manual'} item={item} heldCard={heldCard} />;
}

function ReviewForm({ item, heldCard }: { item?: ScanItem; heldCard?: BusinessCard }) {
  const session = useVault();
  const router = useRouter();
  const desktop = useWindowDimensions().width >= DESKTOP_MIN_WIDTH;
  const [fields, setFields] = useState<CardField[]>(() => {
    const base = item ? initialFields(item) : heldCard ? heldCard.fields : [];
    return FIELD_ORDER.map(({ key }) => base.find((f) => f.key === key) ?? { key, value: '', source: 'user' as const, verified: false });
  });
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [showImage, setShowImage] = useState(true);

  const probe = useMemo(() => {
    const v = (k: CardFieldKey) => fields.find((f) => f.key === k)?.value.trim() ?? '';
    return { fullName: v('fullName'), fullNameKana: v('fullNameKana') || undefined, company: v('company') || undefined, emails: v('email') ? [v('email')] : [], phones: [v('mobile'), v('phone')].filter(Boolean) };
  }, [fields]);
  const candidates = useMemo(() => {
    if (!probe.fullName && !probe.emails.length && !probe.phones.length) return [];
    const subjects = [...session.index.views.values()].map((v) => ({ id: v.contact.id, fullName: v.contact.fullName, fullNameKana: v.contact.fullNameKana, company: v.current?.organization?.name, emails: v.contact.emails, phones: v.contact.phones.map((p) => p.value) }));
    return findDuplicateCandidates(probe, subjects).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute when vault data changes
  }, [probe, session, session.snapshot]);

  const setField = (key: CardFieldKey, patch: Partial<CardField>) => setFields((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const unverified = fields.filter((f) => f.value.trim() && needsVerification(f)).length;

  const save = async (decision: ReviewDecision) => {
    setError(null);
    try {
      const out = fields.filter((f) => f.value.trim()).map((f) => ({ ...f, value: f.value.trim() }));
      const res = await saveReviewedCard(session, { item, fields: out, decision, dismissContactIds: decision.kind === 'new_person' ? candidates.map((c) => c.subjectId) : undefined });
      if (heldCard) await session.remove([heldCard.id]);
      const next = activeItems(session).find((i) => i.status === 'needs_review');
      if (next) router.replace({ pathname: '/scan/review', params: { item: next.id } });
      else if (res.contactId) router.replace(`/people/${res.contactId}`);
      else router.replace('/scan/queue');
    } catch (e) {
      setError(e instanceof ReviewValidationError ? e.message : e instanceof Error ? e.message : '保存できませんでした');
    }
  };

  const imagePanel = item ? (
    <Card style={desktop ? { flex: 1 } : undefined}>
      <Row>
        <T variant="heading">名刺の原本</T>
        {!desktop ? <Button label={showImage ? '原本をたたむ' : '原本を表示'} kind="ghost" compact onPress={() => setShowImage(!showImage)} /> : null}
      </Row>
      {showImage || desktop ? (
        <>
          <CardImage blobId={item.frontBlobId} label="名刺の表面" height={desktop ? 320 : 200} />
          {item.backBlobId ? <CardImage blobId={item.backBlobId} label="名刺の裏面" height={desktop ? 320 : 200} /> : null}
        </>
      ) : null}
      <Button label={showRaw ? 'OCR原文を隠す' : 'OCR原文を表示'} kind="ghost" compact onPress={() => setShowRaw(!showRaw)} />
      {showRaw ? <T variant="small" selectable>{item.ocrLines?.map((l) => l.text).join('\n') || '（認識結果なし）'}</T> : null}
    </Card>
  ) : null;

  return (
    <Screen title="読み取り結果の確認" subtitle={item ? `名刺 #${String(item.index + 1).padStart(3, '0')}・原本と照合してから保存してください` : '手入力で名刺を登録'} back="/scan/queue" testID="screen-review">
      {error ? <Banner tone="danger" testID="review-error">{error}</Banner> : null}
      {item && !item.ocrLines?.length ? <Banner tone="warn">自動読み取りの結果がありません。原本を見ながら入力してください。</Banner> : null}
      {unverified > 0 ? <Banner tone="warn" title={`未確認の項目が${unverified}件あります`}>OCRが推測した値は自動では確定しません。各項目を原本と照合し「確認」を押してください。</Banner> : null}
      <View style={desktop ? { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' } : { gap: space.lg }}>
        {imagePanel}
        <Card style={desktop ? { flex: 1.2 } : undefined}>
          {fields.map((f) => {
            const meta = FIELD_ORDER.find((x) => x.key === f.key)!;
            const fromOcr = f.source === 'ocr';
            return (
              <View key={f.key} style={s.fieldRow}>
                <Row>
                  <T style={s.label}>
                    {meta.label}
                    {meta.required ? '（必須）' : ''}
                  </T>
                  {f.value.trim() ? (
                    f.verified ? <Badge label="確認済み" tone="ok" /> : fromOcr ? <Badge label={`未確認・OCR ${Math.round((f.confidence ?? 0) * 100)}%`} tone="warn" /> : <Badge label="手入力" tone="neutral" />
                  ) : null}
                </Row>
                <View style={s.inputRow}>
                  <TextInput
                    accessibilityLabel={meta.label}
                    testID={`field-${f.key}`}
                    value={f.value}
                    keyboardType={meta.keyboard}
                    autoCapitalize={meta.keyboard ? 'none' : 'sentences'}
                    onChangeText={(value) => setField(f.key, { value, source: f.ocrValue !== undefined && value === f.ocrValue ? 'ocr' : 'user', verified: false })}
                    style={s.input}
                  />
                  <Pressable role="checkbox" aria-checked={f.verified} accessibilityRole="checkbox" accessibilityState={{ checked: f.verified, disabled: !f.value.trim() }} accessibilityLabel={`${meta.label}を確認済みにする`} disabled={!f.value.trim()} onPress={() => setField(f.key, { verified: !f.verified })} style={[s.check, f.verified && s.checkOn]} testID={`verify-${f.key}`}>
                    <T style={{ color: f.verified ? color.white : color.primaryDeep, fontWeight: '700', fontSize: 14 }}>{f.verified ? '✓ 確認' : '確認'}</T>
                  </Pressable>
                </View>
                {f.ocrValue !== undefined && f.value !== f.ocrValue ? <T variant="small" style={{ color: color.muted }}>OCRの値: {f.ocrValue}</T> : null}
              </View>
            );
          })}
          <Button label="入力済みの項目をすべて確認済みにする" kind="ghost" compact testID="verify-all" onPress={() => setFields((prev) => prev.map((f) => (f.value.trim() ? { ...f, verified: true } : f)))} accessibilityHint="原本と照合した場合のみ使用してください" />
        </Card>
      </View>

      {candidates.length > 0 ? (
        <Card style={{ marginTop: space.lg, borderColor: '#EED7B5' }} testID="duplicate-panel">
          <T variant="heading">同じ人物の可能性がある登録があります</T>
          <T variant="muted">自動では統合しません。異動・転職の場合は「同じ人物」を選ぶと、以前の所属は履歴として残ります。</T>
          {candidates.map((c) => {
            const v = session.index.views.get(c.subjectId)!;
            return (
              <View key={c.subjectId} style={s.cand}>
                <View style={{ flex: 1, minWidth: 200 }}>
                  <T style={{ fontWeight: '700' }}>{v.contact.fullName}</T>
                  <T variant="muted">{[v.current?.organization?.name, v.current?.affiliation.title].filter(Boolean).join(' ・ ')}</T>
                  {c.reasons.map((r) => (
                    <T key={r.kind} variant="small">・{r.label}</T>
                  ))}
                </View>
                <Badge label={c.strength === 'strong' ? '一致度: 高' : c.strength === 'possible' ? '一致度: 中' : '一致度: 低'} tone={c.strength === 'strong' ? 'warn' : 'neutral'} />
                <Button label="同じ人物として名刺を追加" compact kind="secondary" onPress={() => save({ kind: 'same_person', contactId: c.subjectId })} testID={`same-person-${c.subjectId}`} />
              </View>
            );
          })}
        </Card>
      ) : null}

      <Row style={{ marginTop: space.lg }}>
        <Button label={candidates.length ? '別人として新規登録' : '確認して保存'} onPress={() => save({ kind: 'new_person' })} testID="save-new" />
        <Button label="保留する（後で判断）" kind="secondary" onPress={() => save({ kind: 'hold' })} testID="save-hold" />
      </Row>
    </Screen>
  );
}

const s = StyleSheet.create({
  fieldRow: { gap: 4, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#EEF1F5' },
  label: { fontWeight: '700', fontSize: 14 },
  inputRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: { flex: 1, minHeight: MIN_TAP, borderWidth: 1, borderColor: color.line, borderRadius: 10, paddingHorizontal: space.md, fontSize: font.body, color: color.ink, backgroundColor: color.white, fontFamily: font.family },
  check: { minHeight: MIN_TAP, minWidth: 72, paddingHorizontal: space.sm, borderRadius: 10, borderWidth: 1, borderColor: color.line, alignItems: 'center', justifyContent: 'center', backgroundColor: color.white },
  checkOn: { backgroundColor: color.ok, borderColor: color.ok },
  cand: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: 10, backgroundColor: color.warnBg },
});
