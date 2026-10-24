// S00 利用開始: purpose, handling of work cards, limits of encryption, and the two start paths.
import { useRouter } from 'expo-router';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useApp, useAppState } from '../../ui/app-context';
import { Banner, Button, Screen, T } from '../../ui/components';
import { color, elevation, font, space } from '../../ui/theme';

const MARK = require('../../../assets/brand/mark.png') as number;
const POINTS = [
  ['撮って、端末の中で読み取る', 'OCRは端末内で動作。名刺の画像を外部に送りません。'],
  ['暗号化したまま、スマホとPCで共有', '同期サーバーに届くのは暗号文だけ。運営者も読めません。'],
  ['AIは提案だけ。勝手に送らない', '削除・統合・送信は必ずあなたが確認してから行います。'],
] as const;

export default function Welcome() {
  const router = useRouter();
  const app = useApp();
  const state = useAppState();
  return (
    <Screen title="名刺管理" subtitle="受け取って、整理して、次につなぐ。" narrow testID="screen-welcome">
      <View style={s.hero}>
        <View style={s.heroHead}>
          <Image source={MARK} style={s.mark} accessibilityIgnoresInvertColors alt="" />
          <Text style={s.heroEyebrow}>このアプリでできること</Text>
        </View>
        <Text style={s.heroTitle} accessibilityRole="header">名刺を、守りながら活かす。</Text>
        <Text style={s.heroBody}>スマートフォンで撮影した名刺を端末内で読み取り、人物・出会いの記録として整理します。PCのブラウザからも同じデータを検索・編集できます。</Text>
        <View style={s.points}>
          {POINTS.map(([title, body]) => (
            <View key={title} style={s.point}>
              <Text style={s.check} aria-hidden>✓</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.pointTitle}>{title}</Text>
                <Text style={s.pointBody}>{body}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>
      <View style={{ height: space.lg }} />
      <Banner tone="info" title="データの守り方">
        名刺の内容と画像はこの端末で暗号化してから保存・同期します。同期サーバーには暗号文だけが届き、復旧キーがなければ運営者も内容を読めません。
      </Banner>
      <Banner tone="warn" title="ご注意ください">
        勤務先から受け取った名刺の取り扱いは、所属組織の規程に従ってください。暗号化は端末のウイルス感染・画面の盗み見・ブラウザ拡張機能による読み取りまでは防げません。復旧キーを失うとデータは復元できません。
      </Banner>
      {state.storeKind === 'indexeddb' ? (
        <Banner tone="neutral" title="ブラウザで利用中">
          ブラウザのデータを消去すると、この端末の保管庫も消えます。同期または暗号化バックアップを有効にしてください。
        </Banner>
      ) : null}
      <View style={{ gap: space.sm, marginTop: space.md }}>
        <Button
          label="新しく始める（この端末で保管庫を作る）"
          testID="start-new"
          onPress={async () => {
            await app.beginCreateVault();
            router.push('/recover');
          }}
        />
        <Button label="既存のデータを復元する（別の端末で使っている）" kind="secondary" testID="start-restore" onPress={() => router.push({ pathname: '/sign-in', params: { mode: 'restore' } })} />
        <T variant="muted">同期を使う場合は、保管庫を作った後に「設定 → 同期」からメール認証でサインインできます。サインインと保管庫の解除は別の操作です。</T>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: color.nav, borderRadius: 18, padding: space.xl, gap: space.md, overflow: 'hidden', ...elevation.raised },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  mark: { width: 40, height: 40, borderRadius: 10 },
  heroEyebrow: { fontFamily: font.family, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, color: color.navMuted },
  heroTitle: { fontFamily: font.family, fontSize: 26, lineHeight: 36, fontWeight: '800', color: color.white, letterSpacing: -0.3 },
  heroBody: { fontFamily: font.family, fontSize: 15, lineHeight: 24, color: color.navText },
  points: { gap: space.md, marginTop: space.sm, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)' },
  point: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  check: { width: 24, height: 24, borderRadius: 12, textAlign: 'center', lineHeight: 24, fontSize: 13, fontWeight: '800', color: '#0E3B27', backgroundColor: '#8FD3B0', overflow: 'hidden' },
  pointTitle: { fontFamily: font.family, fontSize: 15, fontWeight: '700', color: color.white },
  pointBody: { fontFamily: font.family, fontSize: 13, lineHeight: 20, color: color.navMuted },
});
