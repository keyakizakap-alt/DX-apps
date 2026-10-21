// S12 外部AI送信承認: purpose, destination, number of people, per-field exclusion, the exact body,
// provider terms note, and a one-time approval. Default action is cancel; no request before approval.
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { approveAndSend, availableFields, buildPreview, DEFAULT_FIELDS, PREVIEW_TTL_MS, type ExternalPreview } from '../../../core/ai/external';
import { AI_FIELD_LABELS, type AiFieldKey, type DraftResult } from '../../../core/ai/request';
import { externalPreviewSlot, useApp, useAppState, useVault } from '../../../ui/app-context';
import { Badge, Banner, Button, Card, KeyValue, Row, Screen, T, Toggle } from '../../../ui/components';
import { color, space } from '../../../ui/theme';

export default function Approve() {
  const { contact } = useLocalSearchParams<{ contact?: string }>();
  const app = useApp();
  const state = useAppState();
  const session = useVault();
  const router = useRouter();
  const [preview, setPreview] = useState<ExternalPreview | null>(externalPreviewSlot.get());
  const [include, setInclude] = useState<AiFieldKey[]>(preview ? (preview.fields.map((f) => f.key) as AiFieldKey[]) : DEFAULT_FIELDS);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const view = contact ? session.index.views.get(contact) : undefined;

  if (!preview || !view || !state.aiServer?.destination) {
    return (
      <Screen title="外部AIへの送信確認" back="/assistant" narrow>
        <Banner tone="warn">確認する送信内容がありません。アシスタント画面からやり直してください。</Banner>
      </Screen>
    );
  }
  const all = Object.keys(AI_FIELD_LABELS) as AiFieldKey[];
  const values = availableFields(view, view.encounters[0]);
  const toggle = async (k: AiFieldKey, on: boolean) => {
    const next = on ? [...include, k] : include.filter((x) => x !== k);
    setInclude(next);
    const p = await buildPreview(view, view.encounters[0], next, 'formal', state.aiServer!.destination!);
    externalPreviewSlot.set(p);
    setPreview(p);
  };
  const cancel = async () => {
    await session.audit('ai.external_denied', 1, 'denied');
    externalPreviewSlot.set(null);
    setDenied(true);
    router.replace({ pathname: '/assistant', params: { contact: view.contact.id } });
  };
  const expiresIn = Math.max(0, Math.round((preview.createdAt + PREVIEW_TTL_MS - Date.now()) / 60000));

  return (
    <Screen title="外部AIへの送信確認" subtitle="以下の内容を、この1回だけ外部AIに送信します" narrow testID="screen-approve">
      <Banner tone="warn" title="送信すると端末内の暗号化の保護範囲を出ます">
        送信した内容は外部AIの提供元で処理されます。保持期間・学習利用・処理地域は、運営者が提供元との契約条件を確認したうえでこの機能を有効にしています。確認できない場合は送信しないでください。
      </Banner>
      {preview.warnings.map((w) => (
        <Banner key={w} tone="danger" title="指示のような文が含まれています">{w}</Banner>
      ))}
      <Card>
        <KeyValue label="目的" value="メール下書きの文面作成（送信はしません）" />
        <KeyValue label="送信先" value={preview.request.destination} testID="approve-destination" />
        <KeyValue label="対象人数" value={`${preview.request.subjectCount}人`} />
        <KeyValue label="承認の有効期限" value={`確認から約${expiresIn}分・1回限り`} />
        <KeyValue label="内容ハッシュ（SHA-256）" value={`${preview.hash.slice(0, 16)}…`} />
      </Card>
      <View style={{ height: space.md }} />
      <Card>
        <T variant="heading">送信する項目（外せます）</T>
        <T variant="small" style={{ color: color.muted }}>メールアドレス・電話番号・名刺画像は送信できない設計です。</T>
        {all.map((k) => {
          const hasValue = Boolean(values[k]?.trim());
          return (
            <Toggle
              key={k}
              label={hasValue ? AI_FIELD_LABELS[k] : `${AI_FIELD_LABELS[k]}（値なし）`}
              value={hasValue && include.includes(k)}
              onChange={(v) => toggle(k, v)}
              disabled={!hasValue || Boolean(result)}
              testID={`include-${k}`}
            />
          );
        })}
      </Card>
      <View style={{ height: space.md }} />
      <Card>
        <T variant="heading">実際に送信する内容</T>
        <T selectable testID="approve-body" style={{ fontFamily: Platform.select({ web: 'ui-monospace, Consolas, monospace', default: 'Courier' }), fontSize: 13, backgroundColor: '#F2F5F9', padding: space.md, borderRadius: 8 }}>
          {JSON.stringify(preview.request, null, 2)}
        </T>
      </Card>
      {error ? <Banner tone="danger" title="送信できませんでした">{`${error} ローカルの下書きはそのまま使えます。`}</Banner> : null}
      {result ? (
        <Card style={{ marginTop: space.md }} testID="external-result">
          <Row>
            <T variant="heading">外部AIの下書き</T>
            <Badge label="外部AIの生成・未確認" tone="warn" />
          </Row>
          <KeyValue label="件名" value={result.subject} />
          <T selectable>{result.body}</T>
          {result.caveats.map((c) => (
            <T key={c} variant="small" style={{ color: color.warn }}>※ {c}</T>
          ))}
          <T variant="small" style={{ color: color.muted }}>生成内容は人物情報として保存されません。事実関係を確認してから使ってください。</T>
          <Button label="下書きをコピー" onPress={async () => { await Clipboard.setStringAsync(`${result.subject}\n\n${result.body}`); }} />
        </Card>
      ) : (
        <Row style={{ marginTop: space.lg }}>
          <Button label="キャンセル（送信しない）" kind="secondary" onPress={cancel} testID="approve-cancel" />
          <Button
            label="この1回だけ許可して送信"
            kind="danger"
            disabled={include.length === 0 || denied}
            testID="approve-send"
            onPress={async () => {
              setError(null);
              try {
                setResult(await approveAndSend({ session, api: app.api, enabled: state.settings.externalAiEnabled, preview }));
                externalPreviewSlot.set(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : '失敗しました');
              }
            }}
          />
        </Row>
      )}
    </Screen>
  );
}
