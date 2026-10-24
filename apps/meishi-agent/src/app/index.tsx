import { Redirect } from 'expo-router';
import { useAppState } from '../ui/app-context';

export default function Index() {
  const { phase } = useAppState();
  if (phase === 'unlocked') return <Redirect href="/home" />;
  if (phase === 'locked') return <Redirect href="/unlock" />;
  if (phase === 'confirm_recovery') return <Redirect href="/recover" />;
  return <Redirect href="/welcome" />;
}
