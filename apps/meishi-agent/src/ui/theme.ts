// Design tokens. Direction: "paper & ink" — a warm paper background (名刺の紙), deep ink navy for
// structure, one calm blue accent for actions, and state carried by text labels (never colour only).
// All text pairs below meet WCAG AA (≥ 4.5:1) on the surfaces they are used on.
import { Platform } from 'react-native';

export const color = {
  white: '#FFFFFF',
  bg: '#F4F3EF', // paper
  surface: '#FFFFFF',
  surfaceMuted: '#FAF9F6',
  ink: '#151C28',
  muted: '#586273', // 5.7:1 on bg, 6.4:1 on white
  subtle: '#7A8494', // decorative / large text only
  primary: '#2450C2', // 6.6:1 with white text
  primaryDeep: '#18388C',
  primaryTint: '#ECF1FC',
  line: '#E3E1D9',
  lineStrong: '#D2CFC4',
  warn: '#8F5414',
  warnBg: '#FCF3E6',
  danger: '#A12A36',
  dangerBg: '#FCEDEE',
  ok: '#1B6A47',
  okBg: '#E7F3EC',
  focus: '#7FA6DE',
  // navigation (dark sidebar)
  nav: '#121A2B',
  navRaised: '#1C2740',
  navText: '#D5DCE9', // 12:1 on nav
  navMuted: '#97A3BA', // 6.6:1 on nav
  navActive: '#FFFFFF',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 14 } as const;
export const font = {
  family: Platform.select({
    web: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", -apple-system, BlinkMacSystemFont, "Segoe UI", Meiryo, sans-serif',
    default: undefined,
  }),
  body: 16,
  small: 13,
  title: 26,
  heading: 18,
  big: 32,
} as const;

/** Soft, layered elevation (web uses box-shadow; native uses the platform shadow props). */
export const elevation = {
  card: Platform.select({
    web: { boxShadow: '0 1px 2px rgba(21,28,40,0.04), 0 4px 16px rgba(21,28,40,0.04)' },
    default: { shadowColor: '#151C28', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  }) as object,
  raised: Platform.select({
    web: { boxShadow: '0 1px 2px rgba(21,28,40,0.06), 0 10px 28px rgba(21,28,40,0.08)' },
    default: { shadowColor: '#151C28', shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  }) as object,
  button: Platform.select({
    web: { boxShadow: '0 1px 1px rgba(24,56,140,0.20), 0 4px 12px rgba(36,80,194,0.22)' },
    default: {},
  }) as object,
} as const;

/** Tabular figures for counts and dates so columns line up. */
export const numeric = { fontVariant: ['tabular-nums'] as ('tabular-nums')[] };

export const MIN_TAP = 44;
export const DESKTOP_MIN_WIDTH = 960;
