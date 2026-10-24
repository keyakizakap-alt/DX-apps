import type { AppState } from '../core/controller';
import type { Tone } from './components';

/** Sync status text. Only claims "同期済み" after a measured successful sync with nothing pending. */
export function syncLabel(s: AppState): { label: string; tone: Tone } {
  const { sync, account } = s;
  if (!account) return { label: 'この端末のみ（同期オフ）', tone: 'neutral' };
  if (sync.conflicts > 0) return { label: `要対応: 競合 ${sync.conflicts}件`, tone: 'danger' };
  switch (sync.status) {
    case 'syncing':
      return { label: '同期中…', tone: 'info' };
    case 'offline':
      return { label: `オフライン（同期待ち ${sync.pending}件）`, tone: 'warn' };
    case 'auth_expired':
      return { label: 'サインインの有効期限切れ', tone: 'warn' };
    case 'error':
      return { label: `同期エラー（未送信 ${sync.pending}件）`, tone: 'danger' };
    default:
      if (sync.pending > 0) return { label: `同期待ち ${sync.pending}件`, tone: 'warn' };
      return sync.lastSyncAt ? { label: `最終同期 ${formatTime(sync.lastSyncAt)}`, tone: 'ok' } : { label: '未同期', tone: 'neutral' };
  }
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const STATUS_LABEL = { confirmed: '確認済み', needs_review: '要確認', on_hold: '保留' } as const;
export const STATUS_TONE: Record<keyof typeof STATUS_LABEL, Tone> = { confirmed: 'ok', needs_review: 'warn', on_hold: 'neutral' };
export const cap99 = (n: number) => (n > 99 ? '99+' : String(n));
