// S00 利用開始: brand and the two start paths only.
import { useRouter } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../../ui/app-context';
import { Button, Screen } from '../../ui/components';
import { color, font, space } from '../../ui/theme';

const MARK = require('../../../assets/brand/mark.png') as number;

export default function Welcome() {
  const router = useRouter();
  const app = useApp();
  return (
    <Screen title="名刺管理" narrow testID="screen-welcome">
      <View style={s.center}>
        <Image source={MARK} style={s.mark} accessibilityIgnoresInvertColors alt="" />
        <Text style={s.tagline}>撮って、整理して、つなぐ。</Text>
      </View>
      <View style={{ gap: space.md }}>
        <Button
          label="新しく始める"
          testID="start-new"
          onPress={async () => {
            await app.beginCreateVault();
            router.push('/recover');
          }}
        />
        <Button label="別の端末のデータを復元" kind="secondary" testID="start-restore" onPress={() => router.push({ pathname: '/sign-in', params: { mode: 'restore' } })} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { alignItems: 'center', gap: space.lg, paddingVertical: space.xxl },
  mark: { width: 88, height: 88, borderRadius: 22 },
  tagline: { fontFamily: font.family, fontSize: 16, color: color.muted, letterSpacing: 0.4 },
});
