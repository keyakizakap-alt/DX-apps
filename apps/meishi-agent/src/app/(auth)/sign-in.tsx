// S00 サインイン（メールOTP）. Signing in authenticates the account only; it never decrypts data.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { SyncHttpError } from '../../core/sync/protocol';
import { useApp, useAppState } from '../../ui/app-context';
import { Badge, Banner, Button, Field, Screen, T } from '../../ui/components';

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
    <Screen title="サインイン" back narrow testID="screen-sign-in">
      {state.account ? <Badge label="サインイン済み" tone="ok" /> : null}
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
            {email} に確認コードを送りました（{Math.round(sent.expiresInSec / 60)}分間有効）
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
