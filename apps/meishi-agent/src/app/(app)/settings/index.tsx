// S14 セキュリティ設定: lock, auto-lock, external AI (off by default), passcode, links to sync/audit/export.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { passcodeProblem } from '../../../core/passcode-policy';
import { useApp, useAppState } from '../../../ui/app-context';
import { Badge, Banner, Button, Card, Chip, Field, Row, Screen, Section, T, Toggle } from '../../../ui/components';
import { syncLabel } from '../../../ui/status';
import { space } from '../../../ui/theme';

export default function Settings() {
  const app = useApp();
  const state = useAppState();
  const router = useRouter();
  const [recoveryKey, setRecoveryKey] = useState('');
  const [passcode, setPasscode] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const sync = syncLabel(state);

  return (
    <Screen title="設定" testID="screen-settings">
      {msg ? <Banner tone={msg.tone}>{msg.text}</Banner> : null}
      <Section title="アクセス保護">
        <Card>
          <T variant="label">自動ロック（無操作の時間）</T>
          <Row>
            {[1, 5, 15, 0].map((m) => (
              <Chip key={m} label={m === 0 ? 'しない（非推奨）' : `${m}分`} selected={state.settings.autoLockMinutes === m} onPress={() => app.updateSettings({ autoLockMinutes: m })} testID={`autolock-${m}`} />
            ))}
          </Row>
          <Toggle label="アプリ・タブを離れたらロック" value={state.settings.lockWhenHidden} onChange={(v) => app.updateSettings({ lockWhenHidden: v })} testID="lock-when-hidden" />
          {Platform.OS === 'web' ? (
            <View style={{ marginTop: space.md, gap: space.sm }}>
              <Row>
                <T variant="label">この端末のパスコード</T>
                <Badge label={state.hasPasscode ? '設定済み' : '未設定'} tone={state.hasPasscode ? 'ok' : 'neutral'} />
              </Row>
              <Field label="復旧キー" value={recoveryKey} onChangeText={setRecoveryKey} autoCapitalize="characters" testID="settings-recovery-key" />
              <Field label="新しいパスコード（10文字以上）" value={passcode} onChangeText={setPasscode} secureTextEntry testID="settings-passcode" error={passcode ? passcodeProblem(passcode) ?? undefined : undefined} />
              <Row>
                <Button label="パスコードを設定" kind="secondary" compact disabled={recoveryKey.length < 20 || passcodeProblem(passcode) !== null} onPress={async () => {
                  try {
                    app.lock();
                    await app.unlockWithRecoveryKey(recoveryKey, passcode);
                    setMsg({ tone: 'ok', text: 'パスコードを設定しました。' });
                    setRecoveryKey('');
                    setPasscode('');
                  } catch (e) {
                    setMsg({ tone: 'danger', text: e instanceof Error ? e.message : '設定できませんでした' });
                    router.replace('/unlock');
                  }
                }} />
                {state.hasPasscode ? <Button label="パスコードを無効にする" kind="ghost" compact onPress={() => app.clearPasscode()} /> : null}
              </Row>
            </View>
          ) : null}
        </Card>
      </Section>

      <Section title="AIの利用範囲">
        <Card>
          <Toggle
            label="外部AIの利用を許可する"
            description="送信のたびに確認します"
            value={state.settings.externalAiEnabled}
            onChange={(v) => app.updateSettings({ externalAiEnabled: v })}
            testID="external-ai-toggle"
          />
          <Row>
            <Badge label={state.settings.externalAiEnabled ? '外部AI: 許可（毎回承認）' : '外部AI: オフ（既定）'} tone={state.settings.externalAiEnabled ? 'warn' : 'ok'} />
            <Badge label={state.aiServer?.available ? `サーバー側: 有効（${state.aiServer.info?.provider ?? state.aiServer.destination}・${state.aiServer.info?.cost ?? ''}）` : 'サーバー側: 未設定'} tone="neutral" />
          </Row>
        </Card>
      </Section>

      <Section title="データと同期">
        <Card>
          <Row>
            <T style={{ flex: 1 }}>同期・端末・競合</T>
            <Badge label={sync.label} tone={sync.tone} />
            <Button label="開く" compact kind="secondary" onPress={() => router.push('/settings/sync')} testID="open-sync" />
          </Row>
          <Row>
            <T style={{ flex: 1 }}>操作履歴（監査ログ）</T>
            <Button label="開く" compact kind="secondary" onPress={() => router.push('/settings/audit')} testID="open-audit" />
          </Row>
          <Row>
            <T style={{ flex: 1 }}>バックアップ・書き出し・削除</T>
            <Button label="開く" compact kind="secondary" onPress={() => router.push('/settings/export')} testID="open-export" />
          </Row>
        </Card>
      </Section>

      <Section title="この端末について">
        <Card>
          <T variant="small">保存方式: {state.storeKind === 'indexeddb' ? 'ブラウザ（暗号化）' : state.storeKind === 'sqlcipher' ? 'SQLCipher（暗号化）' : state.storeKind}</T>
          <T variant="small">OCR: {app.platform.ocr.label}</T>
        </Card>
      </Section>
    </Screen>
  );
}
