// Authenticated shell: PC = left sidebar (always visible), phone = bottom tab bar (5 tabs).
import { Redirect, Slot, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activeItems } from '../../core/scan/queue';
import { useApp, useAppState, useVault } from '../../ui/app-context';
import { Badge } from '../../ui/components';
import { cap99, syncLabel } from '../../ui/status';
import { color, DESKTOP_MIN_WIDTH, elevation, font, MIN_TAP, space } from '../../ui/theme';

const MARK = require('../../../assets/brand/mark.png') as number;

const TABS = [
  { href: '/home', label: 'ホーム', icon: '⌂' },
  { href: '/people', label: '名刺', icon: '☰' },
  { href: '/scan', label: 'スキャン', icon: '＋' },
  { href: '/assistant', label: 'AI', icon: '◎' },
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
    <Pressable accessibilityRole="button" accessibilityLabel="今すぐロック" onPress={() => { app.lock(); router.replace('/unlock'); }} style={desktop ? s.lockDark : s.lock} testID="lock-now">
      <Text style={desktop ? s.lockTextDark : s.lockText}>🔒 ロック</Text>
    </Pressable>
  );

  if (desktop) {
    return (
      <View style={s.desktop}>
        <View style={s.sidebar} accessibilityRole="navigation" aria-label="メインメニュー">
          <View style={s.brandRow}>
            <Image source={MARK} style={s.mark} accessibilityIgnoresInvertColors alt="" />
            <Text style={s.brand}>名刺管理</Text>
          </View>
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
        <Image source={MARK} style={s.markSmall} accessibilityIgnoresInvertColors alt="" />
        <Text style={s.brandSmall} numberOfLines={1}>名刺管理</Text>
        <View style={{ flex: 1 }} />
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
            <View style={[s.tabPill, isActive(t.href) && s.tabPillOn]}>
              <Text style={[s.tabIcon, isActive(t.href) && s.tabActive]}>{t.icon}</Text>
            </View>
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
    <Pressable accessibilityRole="link" accessibilityState={{ selected: active }} accessibilityLabel={count ? `${label}（要確認 ${count}件）` : label} onPress={onPress} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [s.nav, hovered && !active && s.navHover, active && s.navActive]}>
      {active ? <View style={s.navBar} /> : null}
      <Text style={[s.navIcon, active && { color: color.navActive }]}>{icon ?? '·'}</Text>
      <Text style={[s.navText, !icon && s.navTextSub, active && { color: color.navActive }]}>{label}</Text>
      {count ? <Text style={s.navCount}>{count}</Text> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  desktop: { flex: 1, flexDirection: 'row', backgroundColor: color.bg },
  sidebar: { width: 248, backgroundColor: color.nav, paddingHorizontal: space.md, paddingVertical: space.xl, gap: 2 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.sm, marginBottom: space.xl },
  mark: { width: 36, height: 36, borderRadius: 9 },
  markSmall: { width: 28, height: 28, borderRadius: 7 },
  brand: { fontFamily: font.family, fontSize: 17, fontWeight: '800', color: color.navActive, letterSpacing: 0.2 },
  brandSub: { fontFamily: font.family, fontSize: 11, fontWeight: '600', color: color.navMuted, letterSpacing: 0.4 },
  brandSmall: { fontFamily: font.family, fontSize: 16, fontWeight: '800', color: color.ink, flexShrink: 0 },
  navGroup: { fontFamily: font.family, fontSize: 11, fontWeight: '700', color: color.navMuted, marginTop: space.xl, marginBottom: space.xs, paddingHorizontal: space.md, letterSpacing: 1.2 },
  nav: { minHeight: MIN_TAP, borderRadius: 8, paddingHorizontal: space.md, flexDirection: 'row', alignItems: 'center', gap: space.md },
  navHover: { backgroundColor: 'rgba(255,255,255,0.05)' },
  navActive: { backgroundColor: color.navRaised },
  navBar: { position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: 2, backgroundColor: '#7FA6F0' },
  navIcon: { fontFamily: font.family, width: 18, textAlign: 'center', fontSize: 15, color: color.navMuted },
  navText: { fontFamily: font.family, fontSize: 15, fontWeight: '600', color: color.navText, flex: 1 },
  navTextSub: { fontSize: 14, fontWeight: '500' },
  navCount: { fontFamily: font.family, fontSize: 12, fontWeight: '700', color: color.warn, backgroundColor: color.warnBg, borderRadius: 999, paddingHorizontal: 8, overflow: 'hidden' },
  hint: { fontFamily: font.family, fontSize: 12, color: color.navMuted, paddingHorizontal: space.xs },
  lock: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: 10, borderWidth: 1, borderColor: color.lineStrong, backgroundColor: color.white },
  lockText: { fontFamily: font.family, fontSize: 14, fontWeight: '700', color: color.ink },
  lockDark: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(255,255,255,0.04)' },
  lockTextDark: { fontFamily: font.family, fontSize: 14, fontWeight: '700', color: color.navText },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.line },
  tabbar: { flexDirection: 'row', backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.line, ...elevation.raised },
  tab: { flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center', paddingTop: 6, gap: 2 },
  tabPill: { minWidth: 48, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tabPillOn: { backgroundColor: color.primaryTint },
  tabIcon: { fontSize: 17, color: color.muted },
  tabLabel: { fontFamily: font.family, fontSize: 11, fontWeight: '700', color: color.muted },
  tabActive: { color: color.primary },
  tabCount: { position: 'absolute', top: 2, right: '18%', minWidth: 20, textAlign: 'center', fontSize: 11, fontWeight: '700', color: color.white, backgroundColor: color.warn, borderRadius: 999, paddingHorizontal: 4, overflow: 'hidden' },
});
