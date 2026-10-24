// S13 同期状況: account, measured sync state, devices (revocation), conflicts entry, errors by type.
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SyncHttpError } from '../../../core/sync/protocol';
import { useApp, useAppState } from '../../../ui/app-context';
import { Badge, Banner, Button, Card, KeyValue, Row, Screen, Section, T } from '../../../ui/components';
import { formatTime, syncLabel } from '../../../ui/status';
import { space } from '../../../ui/theme';

type Device = { id: string; label: string; createdAt: string; lastSeenAt: string; revoked: boolean; current: boolean };

export default function SyncScreen() {
  const app = useApp();
  const state = useAppState();
  const router = useRouter();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sync = syncLabel(state);

  const loadDevices = async () => {
    if (!state.account) return;
    try {
      setDevices((await app.api.devices()).devices);
    } catch (e) {
      setError(e instanceof SyncHttpError && e.code === 'offline' ? '端末一覧を取得できません（オフライン）' : e instanceof Error ? e.message : '取得できません');
    }
  };
  const accountId = state.account?.accountId;
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    app.api
      .devices()
      .then((r) => !cancelled && setDevices(r.devices))
      .catch((e) => !cancelled && setError(e instanceof SyncHttpError && e.code === 'offline' ? '端末一覧を取得できません（オフライン）' : e instanceof Error ? e.message : '取得できません'));
    return () => {
      cancelled = true;
    };
  }, [app, accountId]);

  const errorHelp: Record<string, string> = {
    offline: 'ネットワークに接続できません。接続後に自動で再送します。',
    auth_expired: 'サインインの有効期限が切れました。再度サインインしてください（端末内のデータはそのままです）。',
    error: 'サーバーでエラーが発生しました。時間をおいて再試行してください。容量の上限に達した場合は、不要な名刺画像を削除するか運営者に相談してください。',
  };

  return (
    <Screen title="同期・端末" subtitle="名刺は端末で暗号化され、サーバーには暗号文だけが保存されます" back="/settings" testID="screen-sync">
      <Row style={{ marginBottom: space.md }}>
        <Badge label={sync.label} tone={sync.tone} testID="sync-label" />
        <Badge label={`未送信 ${state.sync.pending}件`} tone={state.sync.pending ? 'warn' : 'neutral'} />
        <Badge label={state.online ? 'オンライン' : 'オフライン'} tone={state.online ? 'neutral' : 'warn'} />
      </Row>
      {state.sync.status in errorHelp ? <Banner tone="warn" title="同期できていません">{`${errorHelp[state.sync.status]}${state.sync.lastError ? `（${state.sync.lastError}）` : ''}`}</Banner> : null}
      {state.sync.conflicts > 0 ? (
        <Banner tone="danger" title={`競合が${state.sync.conflicts}件あります`} action={<Button label="競合を解決する" compact onPress={() => router.push('/settings/conflicts')} testID="open-conflicts" />}>
          別の端末でも同じ項目が変更されました。どちらも消えていません。採用する内容を選んでください。
        </Banner>
      ) : null}
      {!state.account ? (
        <Card>
          <T variant="heading">この端末だけで利用中</T>
          <T>スマートフォンとPCで同じ名刺を使うには、同期アカウントにサインインします。サインインはアカウントの確認だけで、名刺の復号には復旧キーが必要です。</T>
          <Button label="メールでサインインして同期を始める" onPress={() => router.push('/sign-in')} testID="sync-sign-in" />
        </Card>
      ) : (
        <View style={{ gap: space.lg }}>
          <Card>
            <KeyValue label="最終同期" value={state.sync.lastSyncAt ? formatTime(state.sync.lastSyncAt) : '未同期'} />
            {state.sync.lastReport ? <KeyValue label="前回の結果" value={`送信 ${state.sync.lastReport.pushed}件 / 受信 ${state.sync.lastReport.pulled}件 / 画像 ${state.sync.lastReport.blobsUploaded}件 / 拒否 ${state.sync.lastReport.rejected}件`} /> : null}
            {state.sync.lastReport?.rejected ? <Banner tone="danger">改ざん・巻き戻しの疑いがある同期データを{state.sync.lastReport.rejected}件拒否しました（端末内のデータは変更していません）。</Banner> : null}
            <Row>
              <Button label="今すぐ同期" testID="sync-now" busy={state.sync.status === 'syncing'} onPress={async () => { setError(null); try { await app.syncNow(); } catch { /* shown via state */ } }} />
              <Button label="サインアウト" kind="ghost" onPress={() => app.signOut()} />
            </Row>
          </Card>
          <Section title="サインイン中の端末">
            {error ? <Banner tone="warn">{error}</Banner> : null}
            {devices?.map((d) => (
              <Card key={d.id}>
                <Row>
                  <T style={{ fontWeight: '700', flex: 1 }}>{d.label}{d.current ? '（この端末）' : ''}</T>
                  <Badge label={d.revoked ? 'ログアウト済み' : '有効'} tone={d.revoked ? 'neutral' : 'ok'} />
                  {!d.current && !d.revoked ? <Button label="この端末をログアウト" kind="secondary" compact onPress={async () => { await app.api.revokeDevice(d.id); await loadDevices(); }} /> : null}
                </Row>
                <T variant="small">追加 {formatTime(d.createdAt)} ・ 最終利用 {formatTime(d.lastSeenAt)}</T>
              </Card>
            ))}
            <Banner tone="neutral" title="端末を追加するには">
              新しい端末でこのアプリを開き「既存のデータを復元する」→ 同じメールでサインイン → 復旧キーを入力します。ログアウトはサーバーへの接続を止めるもので、すでに復号されてオフラインにある端末のデータを消去できる保証はありません。
            </Banner>
          </Section>
        </View>
      )}
    </Screen>
  );
}
