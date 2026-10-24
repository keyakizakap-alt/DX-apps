// S00 サインイン（メールOTP）. Signing in authenticates the account only; it never decrypts data.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { SyncHttpError } from '../../core/sync/protocol';
import { useApp, useAppState } from '../../ui/app-context';
import { Badge, Banner, Button, Field, Screen, T } from '../../ui/components';
import { space } from '../../ui/theme';

function describe(e: unknown): string {
  if (e instanceof SyncHttpError) {
    if (e.code === 'offline') return '通信できません。ネットワーク接続を確認して再試行してください。';
    if (e.code === 'rate_limited') return e.message;
    return e.message;
  }
  return e instanceof Error ? e.message : '失敗しました';
}

export default function SignIn() {
  const app = useApp();
  const state = useAppState();
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ expiresInSec: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restoring = mode === 'restore';

  return (
    <Screen title="メールでサインイン" subtitle={restoring ? '同期データを復元するアカウントにサインインします' : '同期用アカウント'} back narrow testID="screen-sign-in">
      <Row2>
        <Badge label={state.account ? 'サインイン済み' : '未サインイン'} tone={state.account ? 'ok' : 'neutral'} />
        <Badge label={state.phase === 'unlocked' ? '保管庫: 解除中' : '保管庫: ロック中/未作成'} tone="neutral" />
      </Row2>
      <Banner tone="info">サインインはアカウントの確認のみです。名刺を読むには、別途「復旧キー」で保管庫を解除します。</Banner>
      {error ? <Banner tone="danger" title="エラー">{error}</Banner> : null}
      {!sent ? (
        <View>
          <Field label="メールアドレス" testID="email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" inputMode="email" required />
          <Button
            label="確認コードを送る"
            testID="send-code"
            disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}
            onPress={async () => {
              setError(null);
              try {
                setSent(await app.startSignIn(email));
              } catch (e) {
                setError(describe(e));
              }
            }}
          />
        </View>
      ) : (
        <View>
          <T variant="muted" role="status">
            {email} に6桁の確認コードを送りました（{Math.round(sent.expiresInSec / 60)}分間有効）。届かない場合は迷惑メールフォルダを確認し、再送してください。
          </T>
          <Field label="確認コード（6桁）" testID="otp" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" inputMode="numeric" autoComplete="one-time-code" required />
          <Button
            label="サインイン"
            testID="verify-code"
            disabled={code.length !== 6}
            onPress={async () => {
              setError(null);
              try {
                const r = await app.verifySignIn(code);
                if (state.phase === 'unlocked') router.replace('/settings/sync');
                else if (restoring && r.hasVault) router.replace({ pathname: '/recover', params: { mode: 'restore' } });
                else if (restoring && !r.hasVault) setError('このアカウントには保管庫がまだありません。最初の端末で保管庫を作成し、同期を有効にしてください。');
                else router.replace('/welcome');
              } catch (e) {
                setError(describe(e));
              }
            }}
          />
          <Button label="コードを再送する" kind="ghost" onPress={() => { setSent(null); setCode(''); }} />
        </View>
      )}
    </Screen>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.md, flexWrap: 'wrap' }}>{children}</View>;
}
