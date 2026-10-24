// Design tokens from references/UI_UX_SPEC_v1.1.md §1 (white / navy / gray; state by label, not colour only).
import { Platform } from 'react-native';

export const color = {
  white: '#FFFFFF',
  bg: '#F7F8FA',
  ink: '#172B44',
  muted: '#55657A', // ≥ 4.5:1 on white and bg
  primary: '#2156A5',
  primaryDeep: '#173F7A',
  primaryTint: '#EAF1FB',
  line: '#DCE3EB',
  warn: '#9A5B17',
  warnBg: '#FDF4E7',
  danger: '#A12A36',
  dangerBg: '#FCEDEE',
  ok: '#1E6B47',
  okBg: '#E8F4EE',
  focus: '#7FA6DE',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 14 } as const;
export const font = {
  family: Platform.select({ web: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, sans-serif', default: undefined }),
  body: 16,
  small: 13,
  title: 22,
  heading: 18,
  big: 28,
} as const;
export const MIN_TAP = 44;
export const DESKTOP_MIN_WIDTH = 960;
