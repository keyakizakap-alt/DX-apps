// Authenticated shell: PC = left sidebar (always visible), phone = bottom tab bar (5 tabs).
import { Redirect, Slot, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activeItems } from '../../core/scan/queue';
import { useApp, useAppState, useVault } from '../../ui/app-context';
import { Badge } from '../../ui/components';
import { cap99, syncLabel } from '../../ui/status';
import { color, DESKTOP_MIN_WIDTH, font, MIN_TAP, space } from '../../ui/theme';

const TABS = [
  { href: '/home', label: 'ホーム', icon: '⌂' },
  { href: '/people', label: '名刺', icon: '☰' },
  { href: '/scan', label: 'スキャン', icon: '＋' },
  { href: '/assistant', label: 'AI', icon: '✦' },
  { href: '/settings', label: '設定', icon: '⚙' },
] as const;

const EXTRA = [
  { href: '/scan/queue', label: '取込キュー' },
  { href: '/duplicates', label: '重複候補' },
  { href: '/settings/sync', label: '同期・端末' },
  { href: '/settings/audit', label: '操作履歴' },
  { href: '/settings/export', label: '書き出し・削除' },
] as const;

export default function AppLayout() {
  const app = useApp();
  const state = useAppState();
  const session = useVault();
  const router = useRouter();
  const path = usePathname();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const desktop = width >= DESKTOP_MIN_WIDTH;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        router.push({ pathname: '/people', params: { focus: '1' } });
      } else if (e.key === 'n' || e.key === 'N') {
        router.push('/scan');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  if (state.phase !== 'unlocked' || !session?.unlocked) return <Redirect href={state.phase === 'welcome' ? '/welcome' : '/unlock'} />;

  const review = session.all('contact').filter((c) => c.status !== 'confirmed').length + session.all('card').filter((c) => !c.contactId).length + activeItems(session).filter((i) => i.status === 'needs_review').length;
  const sync = syncLabel(state);
  const isActive = (href: string) => (href === '/home' ? path === '/home' : path === href || path.startsWith(`${href}/`));

  const lockButton = (
    <Pressable accessibilityRole="button" accessibilityLabel="今すぐロック" onPress={() => { app.lock(); router.replace('/unlock'); }} style={s.lock} testID="lock-now">
      <Text style={s.lockText}>🔒 ロック</Text>
    </Pressable>
  );

  if (desktop) {
    return (
      <View style={s.desktop}>
        <View style={s.sidebar} accessibilityRole="navigation" aria-label="メインメニュー">
          <Text style={s.brand}>名刺管理</Text>
          {TABS.map((t) => (
            <NavItem key={t.href} label={t.label} icon={t.icon} active={isActive(t.href)} onPress={() => router.push(t.href)} count={t.href === '/people' && review ? cap99(review) : undefined} />
          ))}
          <Text style={s.navGroup}>管理</Text>
          {EXTRA.map((t) => (
            <NavItem key={t.href} label={t.label} active={isActive(t.href)} onPress={() => router.push(t.href)} />
          ))}
          <View style={{ flex: 1 }} />
          <View style={{ gap: space.sm }}>
            <Pressable accessibilityRole="button" onPress={() => router.push('/settings/sync')} accessibilityLabel={`同期状態: ${sync.label}`} style={{ minHeight: MIN_TAP, justifyContent: 'center' }}>
              <Badge label={sync.label} tone={sync.tone} testID="sync-status" />
            </Pressable>
            <Text style={s.hint}>ショートカット: / 検索・N 取り込み</Text>
            {lockButton}
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Slot />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <View style={s.topbar}>
        <Text style={s.brandSmall}>名刺管理</Text>
        <Pressable accessibilityRole="button" onPress={() => router.push('/settings/sync')} accessibilityLabel={`同期状態: ${sync.label}`} style={{ flexShrink: 1, minHeight: MIN_TAP, justifyContent: 'center' }}>
          <Badge label={sync.label} tone={sync.tone} testID="sync-status" />
        </Pressable>
        {lockButton}
      </View>
      <View style={{ flex: 1 }}>
        <Slot />
      </View>
      <View style={[s.tabbar, { paddingBottom: Math.max(insets.bottom, 4) }]} accessibilityRole="tablist">
        {TABS.map((t) => (
          <Pressable key={t.href} accessibilityRole="tab" accessibilityState={{ selected: isActive(t.href) }} accessibilityLabel={t.href === '/people' && review ? `${t.label}（要確認 ${cap99(review)}件）` : t.label} onPress={() => router.push(t.href)} style={s.tab} testID={`tab-${t.href.slice(1)}`}>
            <Text style={[s.tabIcon, isActive(t.href) && s.tabActive]}>{t.icon}</Text>
            <Text style={[s.tabLabel, isActive(t.href) && s.tabActive]}>{t.label}</Text>
            {t.href === '/people' && review ? <Text style={s.tabCount}>{cap99(review)}</Text> : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function NavItem({ label, icon, active, onPress, count }: { label: string; icon?: string; active: boolean; onPress: () => void; count?: string }) {
  return (
    <Pressable accessibilityRole="link" accessibilityState={{ selected: active }} accessibilityLabel={count ? `${label}（要確認 ${count}件）` : label} onPress={onPress} style={[s.nav, active && s.navActive]}>
      <Text style={[s.navText, active && { color: color.primary }]}>
        {icon ? `${icon}  ` : '    '}
        {label}
      </Text>
      {count ? <Text style={s.navCount}>{count}</Text> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  desktop: { flex: 1, flexDirection: 'row', backgroundColor: color.bg },
  sidebar: { width: 240, backgroundColor: color.white, borderRightWidth: 1, borderRightColor: color.line, padding: space.lg, gap: 2 },
  brand: { fontFamily: font.family, fontSize: 20, fontWeight: '800', color: color.ink, marginBottom: space.lg, letterSpacing: -0.5 },
  brandSmall: { fontFamily: font.family, fontSize: 17, fontWeight: '800', color: color.ink, flex: 1 },
  navGroup: { fontFamily: font.family, fontSize: 11, fontWeight: '700', color: color.muted, marginTop: space.lg, marginBottom: 4, paddingHorizontal: space.md, letterSpacing: 0.6 },
  nav: { minHeight: MIN_TAP, borderRadius: 10, paddingHorizontal: space.md, flexDirection: 'row', alignItems: 'center' },
  navActive: { backgroundColor: color.primaryTint },
  navText: { fontFamily: font.family, fontSize: 15, fontWeight: '600', color: '#3E5068', flex: 1 },
  navCount: { fontFamily: font.family, fontSize: 12, fontWeight: '700', color: color.warn, backgroundColor: color.warnBg, borderRadius: 999, paddingHorizontal: 8, overflow: 'hidden' },
  hint: { fontFamily: font.family, fontSize: 12, color: color.muted },
  lock: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: 10, borderWidth: 1, borderColor: color.line, backgroundColor: color.white },
  lockText: { fontFamily: font.family, fontSize: 14, fontWeight: '700', color: color.ink },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: color.white, borderBottomWidth: 1, borderBottomColor: color.line },
  tabbar: { flexDirection: 'row', backgroundColor: color.white, borderTopWidth: 1, borderTopColor: color.line },
  tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingTop: 4 },
  tabIcon: { fontSize: 18, color: color.muted },
  tabLabel: { fontFamily: font.family, fontSize: 12, fontWeight: '600', color: color.muted },
  tabActive: { color: color.primary },
  tabCount: { position: 'absolute', top: 2, right: '22%', minWidth: 20, textAlign: 'center', fontSize: 11, fontWeight: '700', color: color.white, backgroundColor: color.warn, borderRadius: 999, paddingHorizontal: 4, overflow: 'hidden' },
});
