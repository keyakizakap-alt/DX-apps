// S09 人物詳細
import { useLocalSearchParams } from 'expo-router';
import { useVault } from '../../../../ui/app-context';
import { Screen } from '../../../../ui/components';
import { PersonDetail } from '../../../../ui/person-detail';

export default function PersonPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useVault();
  const name = session.index.views.get(id)?.contact.fullName ?? '人物';
  return (
    <Screen title={name} back="/people" testID="screen-person">
      <PersonDetail id={id} />
    </Screen>
  );
}
