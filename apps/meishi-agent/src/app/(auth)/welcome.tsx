// S00 利用開始: purpose, handling of work cards, limits of encryption, and the two start paths.
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useApp, useAppState } from '../../ui/app-context';
import { Banner, Button, Card, Screen, T } from '../../ui/components';
import { space } from '../../ui/theme';

export default function Welcome() {
  const router = useRouter();
  const app = useApp();
  const state = useAppState();
  return (
    <Screen title="名刺管理" subtitle="受け取って、整理して、次につなぐ。" narrow testID="screen-welcome">
      <Card>
        <T variant="heading">このアプリでできること</T>
        <T>スマートフォンで撮影した名刺を端末内で読み取り、人物・出会いの記録として整理します。PCのブラウザからも同じデータを検索・編集できます。</T>
      </Card>
      <View style={{ height: space.md }} />
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
