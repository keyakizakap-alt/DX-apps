// S14 操作履歴: time, action, count, outcome only — no names, e-mails or card text.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { AuditEvent } from '../../../core/audit';
import { useApp, useVault } from '../../../ui/app-context';
import { Badge, EmptyState, Row, Screen, T } from '../../../ui/components';
import { formatTime } from '../../../ui/status';
import { color, space } from '../../../ui/theme';

const LABEL: Record<string, string> = {
  'vault.create': '保管庫の作成', 'vault.unlock': 'ロック解除', 'vault.unlock_failed': 'ロック解除の失敗', 'vault.lock': 'ロック', 'vault.passcode_set': 'パスコード設定', 'vault.passcode_cleared': 'パスコード無効化',
  'record.create': 'データ登録', 'record.update': 'データ修正', 'record.delete': 'データ削除', 'scan.import': '名刺の取り込み', 'scan.ocr': '端末内OCR', 'duplicate.decision': '重複の判断',
  'sync.push': '同期（送信）', 'sync.pull': '同期（受信）', 'sync.conflict': '競合の検出', 'sync.conflict_resolved': '競合の解決', 'sync.rollback_rejected': '不正な同期データの拒否', 'sync.error': '同期エラー',
  'ai.local_query': 'AI（ローカル処理）', 'ai.external_preview': '外部AI送信の確認', 'ai.external_approved': '外部AI送信の承認', 'ai.external_denied': '外部AI送信の拒否', 'ai.external_sent': '外部AIへ送信', 'ai.external_failed': '外部AI送信の失敗', 'ai.policy_denied': 'AIの操作を拒否',
  'export.backup': '暗号化バックアップ', 'export.csv': 'CSV書き出し（平文）', 'data.wipe_local': '端末データ削除', 'account.delete': 'アカウント削除', 'auth.sign_in': 'サインイン', 'auth.sign_out': 'サインアウト', 'settings.change': '設定変更',
};

export default function Audit() {
  const app = useApp();
  const session = useVault();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [chain, setChain] = useState<{ ok: boolean } | null>(null);
  useEffect(() => {
    void app.audit().then(setEvents);
    void app.verifyAudit().then(setChain);
  }, [app, session.snapshot]);
  return (
    <Screen title="操作履歴" back="/settings" testID="screen-audit">
      {chain ? (
        <Badge label={chain.ok ? '改ざん検知: 異常なし（ハッシュチェーン一致）' : '改ざん検知: 記録の不整合があります'} tone={chain.ok ? 'ok' : 'danger'} testID="audit-chain" />
      ) : null}
      {events && events.length === 0 ? <EmptyState title="記録はまだありません" /> : null}
      <View style={{ gap: 4 }}>
        {events?.slice(0, 300).map((e, i) => (
          <Row key={i} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: color.line, gap: space.md }} wrap={false}>
            <T variant="small" style={{ width: 92 }}>{formatTime(e.at)}</T>
            <T variant="small" style={{ flex: 1 }}>{LABEL[e.action] ?? e.action}</T>
            <T variant="small" style={{ width: 48, textAlign: 'right' }}>{e.count}件</T>
            <Badge label={e.outcome === 'success' ? '成功' : e.outcome === 'denied' ? '拒否' : '失敗'} tone={e.outcome === 'success' ? 'ok' : e.outcome === 'denied' ? 'warn' : 'danger'} />
          </Row>
        ))}
      </View>
    </Screen>
  );
}
