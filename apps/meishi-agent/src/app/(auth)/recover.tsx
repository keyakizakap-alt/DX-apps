// S01 保管庫作成・復旧キー確認 / 既存保管庫の復元.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { useApp, useAppState } from '../../ui/app-context';
import { Banner, Button, Card, Field, Screen, T } from '../../ui/components';
import { passcodeProblem } from '../../core/passcode-policy';
import { copySensitive } from '../../ui/clipboard';
import { downloadText } from '../../ui/download';
import { color, space } from '../../ui/theme';

export default function Recover() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  return mode === 'restore' ? <Restore /> : <CreateConfirm />;
}

function CreateConfirm() {
  const app = useApp();
  const state = useAppState();
  const router = useRouter();
  const pending = state.pendingRecovery;
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, setStored] = useState(false);
  const [revealed, setRevealed] = useState(false);
  if (!pending) {
    return (
      <Screen title="保管庫の作成" back="/welcome" narrow>
        <Banner tone="warn">作成手順が中断されました。最初からやり直してください。</Banner>
        <Button label="最初の画面へ" onPress={() => router.replace('/welcome')} />
      </Screen>
    );
  }
  const [g1, g2] = pending.groups;
  return (
    <Screen title="復旧キーを保管してください" subtitle="手順 1/2" narrow testID="screen-recover">
      <Banner tone="danger" title="復旧キーを失うとデータは戻りません">別の場所に保管してください</Banner>
      <Card>
        <T variant="label">復旧キー</T>
        {revealed ? (
          <T selectable style={{ fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Consolas, monospace', default: 'Courier' }), fontSize: 17, letterSpacing: 1, color: color.ink }} testID="recovery-key">
            {pending.recoveryKey}
          </T>
        ) : (
          <T variant="muted" testID="recovery-key-hidden">••••• ••••• •••••</T>
        )}
        <Button label={revealed ? '復旧キーを隠す' : '復旧キーを表示'} kind="secondary" compact onPress={() => setRevealed(!revealed)} testID="reveal-recovery-key" />
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          {Platform.OS === 'web' ? (
            <Button label="テキストファイルで保存" kind="secondary" compact onPress={() => void downloadText(`名刺管理 復旧キー\n${pending.recoveryKey}\n\nこのファイルは安全な場所に保管し、共有しないでください。\n`, 'meishi-recovery-key.txt').then(() => setStored(true), () => setStored(false))} />
          ) : null}
          <Button label="コピー" kind="secondary" compact onPress={async () => { await copySensitive(pending.recoveryKey); setStored(true); }} accessibilityHint="60秒後にクリップボードから消去します" />
        </View>
      </Card>
      <View style={{ height: space.lg }} />
      <T variant="heading">手順 2/2 保管できたか確認</T>
      <T variant="muted">MK1- の後の {g1} 番目と {g2} 番目のブロック</T>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Field label={`${g1} 番目のブロック`} testID="confirm-a" value={a} onChangeText={setA} autoCapitalize="characters" maxLength={5} />
      <Field label={`${g2} 番目のブロック`} testID="confirm-b" value={b} onChangeText={setB} autoCapitalize="characters" maxLength={5} />
      {Platform.OS === 'web' ? (
        <Field
          label="この端末用のパスコード（任意・10文字以上）"
          error={passcode ? passcodeProblem(passcode) ?? undefined : undefined}
          testID="new-passcode"
          value={passcode}
          onChangeText={setPasscode}
          secureTextEntry
          autoComplete="new-password"
        />
      ) : null}
      <View style={{ gap: space.sm }}>
        <Button
          label="確認して保管庫を開く"
          testID="confirm-recovery"
          disabled={a.length !== 5 || b.length !== 5 || (passcode.length > 0 && passcodeProblem(passcode) !== null)}
          onPress={async () => {
            setError(null);
            try {
              await app.confirmRecoveryKey([a, b], passcode || undefined);
              router.replace('/home');
            } catch (e) {
              setError(e instanceof Error && e.name === 'RecoveryKeyFormatError' ? '入力したブロックが復旧キーと一致しません。保管した復旧キーを確認してください。' : e instanceof Error ? e.message : '失敗しました');
            }
          }}
        />
        <Button label="やめる" kind="ghost" onPress={() => { app.cancelCreateVault(); router.replace('/welcome'); }} />
      </View>
    </Screen>
  );
}

function Restore() {
  const app = useApp();
  const state = useAppState();
  const router = useRouter();
  const [key, setKey] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Screen title="既存の保管庫を復元" back="/welcome" narrow testID="screen-restore">
      {!state.account ? (
        <Banner tone="warn" action={<Button label="サインインする" compact onPress={() => router.push({ pathname: '/sign-in', params: { mode: 'restore' } })} />}>
          先に同期アカウントにサインインしてください。
        </Banner>
      ) : (
        <Banner tone="ok">サインイン済み</Banner>
      )}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Field label="復旧キー" testID="restore-key" value={key} onChangeText={setKey} autoCapitalize="characters" autoCorrect={false} placeholder="MK1-XXXXX-XXXXX-…" multiline />
      {Platform.OS === 'web' ? <Field label="この端末用のパスコード（任意・10文字以上）" value={passcode} onChangeText={setPasscode} secureTextEntry testID="restore-passcode" error={passcode ? passcodeProblem(passcode) ?? undefined : undefined} /> : null}
      <Button
        label="復元して開く"
        testID="restore-submit"
        disabled={!state.account || key.trim().length < 20 || (passcode.length > 0 && passcodeProblem(passcode) !== null)}
        onPress={async () => {
          setError(null);
          try {
            await app.restoreFromServer(key, passcode || undefined);
            router.replace('/home');
          } catch (e) {
            setError(e instanceof Error ? (e.name === 'DecryptionError' ? '復旧キーが違います。' : e.message) : '失敗しました');
          }
        }}
      />
    </Screen>
  );
}
