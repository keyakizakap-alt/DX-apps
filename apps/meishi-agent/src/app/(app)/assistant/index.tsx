// S11 AIアシスタント: on-device rule-based search / follow-ups / drafts with sources. External AI is
// a separate, explicitly labelled path that always goes through S12.
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { askAssistant, localDraft, type AssistantAnswer, type LocalDraft } from '../../../core/ai/assistant';
import { buildPreview, DEFAULT_FIELDS } from '../../../core/ai/external';
import type { ContactBrief } from '../../../core/ai/gateway';
import { externalPreviewSlot, useAppState, useVault } from '../../../ui/app-context';
import { Badge, Banner, Button, Card, Chip, Field, Row, Screen, T } from '../../../ui/components';
import { color, MIN_TAP, space } from '../../../ui/theme';

const STARTERS = ['先月の展示会で会った人', 'フォローすべき人', '重複している人', '#技術'];

export default function Assistant() {
  const params = useLocalSearchParams<{ q?: string; contact?: string }>();
  const session = useVault();
  const state = useAppState();
  const router = useRouter();
  const [q, setQ] = useState(params.q ?? '');
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [draft, setDraft] = useState<LocalDraft | null>(null);
  const [copied, setCopied] = useState(false);
  const [extError, setExtError] = useState<string | null>(null);

  const ask = async (text: string) => {
    const a = await askAssistant(session, text, new Date());
    setAnswer(a);
    setDraft(a.draft ?? null);
  };
  const run = (text: string) => {
    setQ(text);
    setCopied(false);
    return ask(text);
  };
  const [handled, setHandled] = useState<string | undefined>(undefined);
  const paramKey = `${params.contact ?? ''}|${params.q ?? ''}`;
  if (handled !== paramKey) {
    // React to new route params during render (no effect): draft for ?contact=, otherwise run ?q=.
    setHandled(paramKey);
    if (params.q) setQ(params.q);
    const view = params.contact ? session.index.views.get(params.contact) : undefined;
    if (view) {
      setDraft(localDraft(view));
      setAnswer(null);
    }
  }
  useEffect(() => {
    if (params.contact || !params.q) return;
    let cancelled = false;
    void askAssistant(session, params.q, new Date()).then((a) => {
      if (cancelled) return;
      setAnswer(a);
      setDraft(a.draft ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [session, params.q, params.contact]);

  const externalReady = state.settings.externalAiEnabled && state.aiServer?.available && state.account;
  const openExternal = async () => {
    setExtError(null);
    if (!draft) return;
    const view = session.index.views.get(draft.contactId);
    if (!view || !state.aiServer?.destination) return;
    try {
      externalPreviewSlot.set(await buildPreview(view, view.encounters[0], DEFAULT_FIELDS, 'formal', state.aiServer.destination));
      router.push({ pathname: '/assistant/approve', params: { contact: draft.contactId } });
    } catch (e) {
      setExtError(e instanceof Error ? e.message : '送信内容を作成できませんでした');
    }
  };

  const result = answer?.result;
  return (
    <Screen title="AIアシスタント" subtitle="登録済みの名刺・メモを手がかりに、人物の検索や連絡準備を支援します" testID="screen-assistant">
      <Row style={{ marginBottom: space.md }}>
        <Badge label="既定: ローカル処理（端末内）" tone="ok" />
        <Badge label={state.settings.externalAiEnabled ? '外部AI: 許可済み（送信は毎回承認）' : '外部AI: オフ'} tone={state.settings.externalAiEnabled ? 'warn' : 'neutral'} />
      </Row>
      <Card>
        <Field label="何を手伝いましょうか？" value={q} onChangeText={setQ} onSubmitEditing={() => q.trim() && run(q)} placeholder="例: 先月の展示会で会った人 / 架空 花子さんへのお礼メール" testID="assistant-input" />
        <Row>
          <Button label="端末内で調べる" onPress={() => run(q)} disabled={!q.trim()} testID="assistant-run" />
          {STARTERS.map((s) => (
            <Chip key={s} label={s} onPress={() => run(s)} />
          ))}
        </Row>
        <T variant="small" style={{ color: color.muted }}>AIは名刺の削除・統合・送信・共有・書き出しを行えません。名刺やメモに書かれた指示文は命令として扱いません。</T>
      </Card>

      {answer ? (
        <View style={{ marginTop: space.lg, gap: space.sm }} testID="assistant-answer">
          <Row>
            <Badge label="ローカル処理" tone="ok" />
            <T style={{ fontWeight: '700' }} role="status">{answer.message}</T>
          </Row>
          {answer.explanation.length ? <T variant="small" style={{ color: color.muted }}>解釈: {answer.explanation.join(' / ')}</T> : null}
          {answer.candidates?.map((c) => (
            <PersonRow key={c.id} b={c} onPress={() => { setDraft(localDraft(session.index.views.get(c.id)!)); }} hint="この人で下書き" />
          ))}
          {result && result.ok && result.tool === 'searchContacts' ? result.items.map((b) => <PersonRow key={b.id} b={b} onPress={() => router.push(`/people/${b.id}`)} />) : null}
          {result && result.ok && result.tool === 'suggestFollowUps'
            ? result.items.map((s) => <PersonRow key={s.contactId} b={s.brief} onPress={() => router.push(`/people/${s.contactId}`)} hint={`根拠: ${s.reason}`} />)
            : null}
          {result && result.ok && result.tool === 'findDuplicates' ? (
            <>
              {result.items.map((p) => (
                <T key={p.a.id + p.b.id}>・{p.a.name}（{p.a.company}） ⇔ {p.b.name}（{p.b.company}）: {p.candidate.reasons.map((r) => r.label).join('、')}</T>
              ))}
              <Button label="重複候補の画面で判断する" kind="secondary" compact onPress={() => router.push('/duplicates')} />
            </>
          ) : null}
          {result && result.ok && result.tool === 'getContactSummary'
            ? result.items.map((it) => (
                <Card key={it.id}>
                  <T style={{ fontWeight: '700' }}>{it.name}</T>
                  {it.encounters.map((e) => (
                    <T key={e.id} variant="small">・{e.date} {e.event ?? ''} {e.conversation ?? ''} {e.nextAction ? `→ ${e.nextAction}` : ''}（出典: 出会いメモ {e.date}）</T>
                  ))}
                </Card>
              ))
            : null}
          {result && !result.ok ? <Banner tone="warn">{result.reason}</Banner> : null}
        </View>
      ) : null}

      {draft ? (
        <Card style={{ marginTop: space.lg }} testID="draft-card">
          <Row>
            <T variant="heading">メールの下書き</T>
            <Badge label="ローカル処理・テンプレート" tone="ok" />
          </Row>
          <Field label="件名" value={draft.subject} onChangeText={(subject) => setDraft({ ...draft, subject })} />
          <Field label="本文（編集できます）" value={draft.body} onChangeText={(body) => setDraft({ ...draft, body })} multiline style={{ minHeight: 220 }} testID="draft-body" />
          <T variant="small">参照した情報: {draft.sources.map((s) => s.label).join('、')}</T>
          {draft.assumptions.map((a) => (
            <T key={a} variant="small" style={{ color: color.warn }}>※ {a}</T>
          ))}
          {copied ? <Banner tone="ok">コピーしました。メールソフトに貼り付けて、宛先と内容を確認してから送信してください。</Banner> : null}
          <Row>
            <Button label="下書きをコピー" onPress={async () => { await Clipboard.setStringAsync(`${draft.subject}\n\n${draft.body}`); setCopied(true); }} testID="copy-draft" />
            <Button label="外部AIで文面を整える…" kind="secondary" disabled={!externalReady} onPress={openExternal} testID="external-ai" />
          </Row>
          {!externalReady ? (
            <T variant="small" style={{ color: color.muted }}>
              {!state.settings.externalAiEnabled ? '外部AIは設定でオフです（初期設定）。' : !state.account ? '外部AIの利用には同期アカウントへのサインインが必要です。' : 'サーバーで外部AIが有効化されていません（運営者の設定が必要）。'}
            </T>
          ) : null}
          {extError ? <Banner tone="danger">{extError}</Banner> : null}
          <T variant="small" style={{ color: color.muted }}>このアプリはメールを送信しません。</T>
        </Card>
      ) : null}
    </Screen>
  );
}

function PersonRow({ b, onPress, hint }: { b: ContactBrief; onPress: () => void; hint?: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={s.row} testID="assistant-person">
      <View style={{ flex: 1 }}>
        <T style={{ fontWeight: '700' }}>{b.name}</T>
        <T variant="muted">{[b.company, b.title, b.lastMetAt && `最終面会 ${b.lastMetAt}`].filter(Boolean).join(' ・ ')}</T>
        {b.matched?.length ? <T variant="small">一致した項目: {b.matched.join('、')}</T> : null}
        {hint ? <T variant="small">{hint}</T> : null}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { minHeight: MIN_TAP, padding: space.md, borderRadius: 10, borderWidth: 1, borderColor: color.line, backgroundColor: color.white },
});
