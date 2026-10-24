// iOS/Android screen privacy (expo-screen-capture, SDK 58): blocks screenshots/recordings
// (Android FLAG_SECURE also blanks the recent-apps preview) and blurs the iOS app switcher.
// STATUS: implemented against the SDK 58 docs/types; NOT verified on a device.
import * as ScreenCapture from 'expo-screen-capture';
import { Platform } from 'react-native';

export async function enableScreenPrivacy(): Promise<void> {
  try {
    await ScreenCapture.preventScreenCaptureAsync('meishi');
    if (Platform.OS === 'ios') await ScreenCapture.enableAppSwitcherProtectionAsync(1.0);
  } catch {
    // Unsupported OS version: the in-app cover (PrivacyCover) and auto-lock still apply.
  }
}
