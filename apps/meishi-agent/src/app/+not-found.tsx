import { useRouter } from 'expo-router';
import { Button, EmptyState, Screen } from '../ui/components';

export default function NotFound() {
  const router = useRouter();
  return (
    <Screen title="ページが見つかりません" narrow>
      <EmptyState title="このページは存在しません" action={<Button label="ホームへ" onPress={() => router.replace('/')} />} />
    </Screen>
  );
}
