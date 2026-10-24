// S15 書き出し・削除: encrypted backup is the default; plaintext CSV and deletions require
// re-authentication with the recovery key and an explicit count / phrase confirmation.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { contactsToCsv, createEncryptedBackup, restoreEncryptedBackup, verifyRecoveryKey, type EncryptedBackup } from '../../../core/export';
import { SyncHttpError } from '../../../core/sync/protocol';
import { useApp, useAppState, useVault } from '../../../ui/app-context';
import { Banner, Button, Card, Chip, Field, Row, Screen, Section, T, Toggle } from '../../../ui/components';
import { downloadText } from '../../../ui/download';
import { space } from '../../../ui/theme';

const stamp = () => new Date().toISOString().slice(0, 10);

export default function ExportScreen() {
  const app = useApp();
  const state = useAppState();
  const session = useVault();
  const router = useRouter();
  const [images, setImages] = useState(true);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger' | 'warn'; text: string } | null>(null);
  const [key, setKey] = useState('');
  const [csvConfirm, setCsvConfirm] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [target, setTarget] = useState<'local' | 'account'>('local');
  const count = session.index.contacts.length;
  const web = Platform.OS === 'web';

  const reauth = async () => {
    const env = await app.recoveryEnvelope();
    if (!env || !(await verifyRecoveryKey(session, env, key))) {
      setMsg({ tone: 'danger', text: '復旧キーが確認できませんでした。' });
      return false;
    }
    return true;
  };

  return (
    <Screen title="バックアップ・書き出し・削除" back="/settings" testID="screen-export">
      {msg ? <Banner tone={msg.tone} testID="export-message">{msg.text}</Banner> : null}
      <Section title="暗号化バックアップ（推奨）">
        <Card>
          <T>名刺データを暗号文のまま1つのファイルに保存します。開くには同じ保管庫の復旧キーが必要です。</T>
          <Toggle label="名刺画像も含める" value={images} onChange={setImages} />
          <Row>
            <Button label={`暗号化バックアップを保存（${count}人）`} testID="backup-download" onPress={async () => {
              const env = await app.recoveryEnvelope();
              if (!env) return;
              const backup = await createEncryptedBackup(session, env, images);
              try {
                await downloadText(JSON.stringify(backup), `meishi-backup-${stamp()}.json`, 'application/json');
              } catch (e) {
                setMsg({ tone: 'danger', text: e instanceof Error ? e.message : '保存できませんでした' });
                return;
              }
              setMsg({ tone: 'ok', text: `暗号化バックアップを保存しました（レコード ${backup.records.length}件・画像 ${backup.blobs.length}件）。` });
            }} />
            <Button label="バックアップから復元" kind="secondary" disabled={!web} testID="backup-restore" onPress={async () => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'application/json,.json';
              input.onchange = async () => {
                const f = input.files?.[0];
                if (!f) return;
                try {
                  const r = await restoreEncryptedBackup(session, JSON.parse(await f.text()) as EncryptedBackup);
                  setMsg({ tone: 'ok', text: `復元しました（${r.restored}件、既存の新しいデータを優先し ${r.skipped}件はスキップ）。` });
                } catch (e) {
                  setMsg({ tone: 'danger', text: e instanceof Error ? e.message : '復元できませんでした' });
                }
              };
              input.click();
            }} />
          </Row>
        </Card>
      </Section>

      <Section title="CSVで書き出し（平文）">
        <Card>
          <Banner tone="danger" title="暗号化されていないファイルになります" />
          <Field label="再認証: 復旧キー" value={key} onChangeText={setKey} autoCapitalize="characters" testID="reauth-key" />
          {!csvConfirm ? (
            <Button label="CSVの書き出しを準備" kind="secondary" disabled={key.length < 20} testID="csv-prepare" onPress={async () => { if (await reauth()) setCsvConfirm(true); }} />
          ) : (
            <Banner tone="warn" title={`${count}人分を平文で書き出します`} action={
              <>
                <Button label={`${count}人分を書き出す`} kind="danger" testID="csv-download" onPress={async () => {
                  const { csv, count: n } = contactsToCsv(session);
                  try {
                    await downloadText(csv, `meishi-contacts-${stamp()}.csv`, 'text/csv;charset=utf-8');
                  } catch (e) {
                    await session.audit('export.csv', 0, 'failure');
                    setMsg({ tone: 'danger', text: e instanceof Error ? e.message : '書き出せませんでした' });
                    return;
                  }
                  await session.audit('export.csv', n);
                  setCsvConfirm(false);
                  setKey('');
                  setMsg({ tone: 'warn', text: `${n}人分のCSVを書き出しました（平文）。` });
                }} />
                <Button label="やめる" kind="secondary" onPress={() => setCsvConfirm(false)} />
              </>
            }>
              対象: 全員 / 形式: CSV（UTF-8, Excel対応） / 名刺画像は含みません
            </Banner>
          )}
        </Card>
      </Section>

      <Section title="データの削除">
        <Card>
          <Row>
            <Chip label="この端末のデータを削除" selected={target === 'local'} onPress={() => setTarget('local')} testID="target-local" />
            <Chip label="同期アカウントを削除" selected={target === 'account'} onPress={() => setTarget('account')} testID="target-account" />
          </Row>
          {target === 'local' ? (
            <T>このブラウザ/端末に保存された保管庫・名刺・画像・設定を削除します。同期サーバーや他の端末のデータは消えません（同期済みなら復旧キーで復元できます）。</T>
          ) : (
            <T>サーバー上の暗号文・画像・端末登録をすべて削除します。他の端末は次回の同期でサーバーに接続できなくなりますが、すでに端末内にあるデータは各端末で削除するまで残ります。安全のため、10分以内にサインインし直している必要があります。</T>
          )}
          {target === 'account' && !state.account ? <Banner tone="neutral">同期アカウントにサインインしていません。</Banner> : null}
          <Field label="再認証: 復旧キー" value={key} onChangeText={setKey} autoCapitalize="characters" testID="delete-key" />
          <Field label="確認のため「削除」と入力" value={phrase} onChangeText={setPhrase} testID="delete-phrase" />
          <Button
            label={target === 'local' ? 'この端末のデータを削除する' : '同期アカウントを削除する'}
            kind="danger"
            testID="delete-confirm"
            disabled={phrase !== '削除' || key.length < 20 || (target === 'account' && !state.account)}
            onPress={async () => {
              if (!(await reauth())) return;
              try {
                if (target === 'local') {
                  await app.wipeLocal();
                  router.replace('/welcome');
                } else {
                  await app.deleteAccount();
                  setMsg({ tone: 'ok', text: '同期アカウントを削除しました。この端末のデータは残っています。' });
                }
              } catch (e) {
                setMsg({ tone: 'danger', text: e instanceof SyncHttpError && e.status === 403 ? '安全のため、サインインし直してから削除してください（設定 → 同期 → サインアウト → サインイン）。' : e instanceof Error ? e.message : '削除できませんでした' });
              }
            }}
          />
        </Card>
      </Section>
      <View style={{ height: space.xl }} />
    </Screen>
  );
}
