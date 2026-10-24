import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState as RNAppState, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppController } from '../core/controller';
import { createPlatform } from '../platform';
import { enableScreenPrivacy } from '../platform/privacy';
import { installTrustedTypes, trustedScriptURL } from '../platform/web/trusted-types';
import { AppProvider, useAppState } from '../ui/app-context';
import { Banner, Loading, T } from '../ui/components';
import { color } from '../ui/theme';

// Register the Trusted Types policies before any vendor script can run.
if (Platform.OS === 'web') installTrustedTypes();

function Boot({ children }: { children: React.ReactNode }) {
  const state = useAppState();
  if (state.phase === 'booting') return <Loading label="保管庫を確認しています…" />;
  if (state.phase === 'fatal')
    return (
      <View style={{ padding: 24, maxWidth: 560, alignSelf: 'center' }}>
        <Banner tone="danger" title="起動できません">
          {state.fatal ?? '不明なエラー'}
        </Banner>
      </View>
    );
  return <>{children}</>;
}

export default function RootLayout() {
  const [{ controller, error }] = useState(() => {
    try {
      return { controller: new AppController(createPlatform()), error: null };
    } catch (e) {
      return { controller: null, error: e instanceof Error ? e.message : '起動できません' };
    }
  });

  // Covers the screen whenever the app/tab is not in the foreground, so the OS task switcher or a
  // screen share never shows card data, even when "lock when hidden" is turned off.
  const [covered, setCovered] = useState(false);

  useEffect(() => {
    if (!controller) return;
    void enableScreenPrivacy();
    void controller.boot();
    if (Platform.OS === 'web' && 'serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register(trustedScriptURL('/sw.js')).catch(() => undefined); // offline app shell only
    }
    // Lock when the app is hidden (setting), and treat any interaction as activity for auto-lock.
    if (Platform.OS === 'web') {
      const onVis = () => {
        const hidden = document.visibilityState === 'hidden';
        setCovered(hidden);
        controller.onVisibilityChange(hidden);
      };
      const onActivity = () => controller.touch();
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('pointerdown', onActivity, { passive: true });
      window.addEventListener('keydown', onActivity);
      return () => {
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pointerdown', onActivity);
        window.removeEventListener('keydown', onActivity);
      };
    }
    const sub = RNAppState.addEventListener('change', (s) => {
      setCovered(s !== 'active');
      controller.onVisibilityChange(s !== 'active');
    });
    return () => sub.remove();
  }, [controller]);

  if (!controller)
    return (
      <View style={{ padding: 24, maxWidth: 560, alignSelf: 'center' }}>
        <T variant="title">名刺管理</T>
        <Banner tone="danger" title="この環境では起動できません">
          {error ?? ''}
        </Banner>
      </View>
    );
  return (
    <SafeAreaProvider>
      <AppProvider controller={controller}>
        <StatusBar style="dark" />
        <View style={{ flex: 1, backgroundColor: color.bg }}>
          <Boot>
            <Slot />
          </Boot>
          {covered ? (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="画面を保護しています">
              <T variant="heading">名刺管理</T>
            </View>
          ) : null}
        </View>
      </AppProvider>
    </SafeAreaProvider>
  );
}
