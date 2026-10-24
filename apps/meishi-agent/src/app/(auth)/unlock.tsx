// S02 ロック解除: biometric (native) / passcode (web, optional) / recovery key. Nothing personal is
// shown while locked; wrong attempts are delayed exponentially.
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { useNow } from '../../ui/use-now';
import { View } from 'react-native';
import { UnlockThrottledError } from '../../core/controller';
import { useApp, useAppState } from '../../ui/app-context';
import { Banner, Button, Chip, Field, Row, Screen } from '../../ui/components';
import { space } from '../../ui/theme';

export default function Unlock() {
  const app = useApp();
  const state = useAppState();
  const router = useRouter();
  const [method, setMethod] = useState<'passcode' | 'key'>(state.hasPasscode ? 'passcode' : 'key');
  const [passcodeKnown, setPasscodeKnown] = useState(state.hasPasscode);
  if (passcodeKnown !== state.hasPasscode) {
    // Adjust state when the passcode availability changes (render-time update, no effect needed).
    setPasscodeKnown(state.hasPasscode);
    setMethod(state.hasPasscode ? 'passcode' : 'key');
  }
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const now = useNow(1000);
  if (state.phase === 'welcome') return <Redirect href="/welcome" />;
  const wait = Math.max(0, Math.ceil((state.unlockLockedUntil - now) / 1000));

  const submit = async () => {
    setError(null);
    try {
      if (method === 'passcode') await app.unlockWithPasscode(secret);
      else await app.unlockWithRecoveryKey(secret);
      setSecret('');
      router.replace('/home');
    } catch (e) {
      setError(e instanceof UnlockThrottledError ? e.message : e instanceof Error ? (e.name === 'DecryptionError' ? '復旧キーが違います' : e.name === 'RecoveryKeyFormatError' ? e.message : e.message) : '解除できませんでした');
    }
  };

  return (
    <Screen title="ロック中" narrow testID="screen-unlock">
      {state.biometricAvailable ? (
        <View style={{ marginBottom: space.md }}>
          <Button label="Face ID / 指紋で解除" onPress={async () => { try { await app.unlockWithBiometric(); router.replace('/home'); } catch (e) { setError(e instanceof Error ? e.message : '解除できませんでした'); } }} />
        </View>
      ) : null}
      {state.hasPasscode ? (
        <Row style={{ marginBottom: space.md }}>
          <Chip label="パスコード" selected={method === 'passcode'} onPress={() => { setMethod('passcode'); setSecret(''); }} testID="method-passcode" />
          <Chip label="復旧キー" selected={method === 'key'} onPress={() => { setMethod('key'); setSecret(''); }} testID="method-key" />
        </Row>
      ) : null}
      {wait > 0 ? <Banner tone="warn">試行回数が多すぎます。{wait}秒後に再試行できます。</Banner> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Field
        label={method === 'passcode' ? 'この端末のパスコード' : '復旧キー'}
        testID="unlock-secret"
        value={secret}
        onChangeText={setSecret}
        secureTextEntry={method === 'passcode'}
        autoCapitalize={method === 'key' ? 'characters' : 'none'}
        autoCorrect={false}
        autoComplete={method === 'passcode' ? 'current-password' : 'off'}
        placeholder={method === 'key' ? 'MK1-XXXXX-XXXXX-…' : undefined}
        onSubmitEditing={() => void submit()}
      />
      <Button label="解除する" testID="unlock-submit" disabled={!secret || wait > 0} onPress={submit} />
    </Screen>
  );
}
