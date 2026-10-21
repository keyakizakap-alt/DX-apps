import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState as RNAppState, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppController } from '../core/controller';
import { createPlatform } from '../platform';
import { AppProvider, useAppState } from '../ui/app-context';
import { Banner, Loading, T } from '../ui/components';
import { color } from '../ui/theme';

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

  useEffect(() => {
    if (!controller) return;
    void controller.boot();
    if (Platform.OS === 'web' && 'serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined); // offline app shell only
    }
    // Lock when the app is hidden (setting), and treat any interaction as activity for auto-lock.
    if (Platform.OS === 'web') {
      const onVis = () => controller.onVisibilityChange(document.visibilityState === 'hidden');
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
    const sub = RNAppState.addEventListener('change', (s) => controller.onVisibilityChange(s !== 'active'));
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
        </View>
      </AppProvider>
    </SafeAreaProvider>
  );
}
