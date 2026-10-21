import { Redirect, Slot, usePathname } from 'expo-router';
import { useAppState } from '../../ui/app-context';

export default function AuthLayout() {
  const { phase } = useAppState();
  const path = usePathname();
  // Sign-in is also used from S13 to enable sync while the vault is unlocked.
  if (phase === 'unlocked' && path !== '/sign-in') return <Redirect href="/home" />;
  return <Slot />;
}
