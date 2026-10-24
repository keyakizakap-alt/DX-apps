// Shared UI primitives. Accessible names, 44pt targets, visible focus and text status labels.
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { color, elevation, font, MIN_TAP, numeric, radius, space } from './theme';

export function T({ children, style, variant = 'body', numberOfLines, selectable, role, testID }: { children: ReactNode; style?: StyleProp<TextStyle>; variant?: 'body' | 'small' | 'muted' | 'title' | 'heading' | 'big' | 'label'; numberOfLines?: number; selectable?: boolean; role?: 'heading' | 'alert' | 'status'; testID?: string }) {
  return (
    <Text testID={testID} style={[styles.text, styles[variant], style]} numberOfLines={numberOfLines} selectable={selectable} accessibilityRole={role === 'heading' ? 'header' : role === 'alert' ? 'alert' : undefined} aria-live={role === 'status' ? 'polite' : undefined}>
      {children}
    </Text>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ label, onPress, kind = 'primary', disabled, busy, icon, testID, accessibilityHint, style, compact }: { label: string; onPress?: () => void | Promise<void>; kind?: ButtonKind; disabled?: boolean; busy?: boolean; icon?: string; testID?: string; accessibilityHint?: string; style?: StyleProp<ViewStyle>; compact?: boolean }) {
  const [running, setRunning] = useState(false);
  const isBusy = busy || running;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || isBusy, busy: isBusy }}
      disabled={disabled || isBusy}
      onPress={async () => {
        if (!onPress) return;
        setRunning(true);
        try {
          await onPress();
        } finally {
          setRunning(false);
        }
      }}
      style={({ pressed, focused }: { pressed: boolean; focused?: boolean }) => [styles.button, compact && styles.buttonCompact, styles[`btn_${kind}`], (disabled || isBusy) && styles.disabled, pressed && styles.pressed, focused && styles.focus, style]}
    >
      {isBusy ? <ActivityIndicator size="small" color={kind === 'primary' || kind === 'danger' ? color.white : color.primary} /> : null}
      <Text style={[styles.buttonText, styles[`btnText_${kind}`]]}>
        {icon ? `${icon} ` : ''}
        {label}
      </Text>
    </Pressable>
  );
}

export function Field({ label, hint, error, required, testID, ...input }: TextInputProps & { label: string; hint?: string; error?: string; required?: boolean; testID?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel} nativeID={`${testID ?? label}-label`}>
        {label}
        {required ? <Text style={{ color: color.danger }}>（必須）</Text> : null}
      </Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        aria-invalid={error ? true : undefined}
        placeholderTextColor="#8391A3"
        {...input}
        onFocus={(e) => {
          setFocused(true);
          input.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          input.onBlur?.(e);
        }}
        style={[styles.input, input.multiline && styles.inputMultiline, focused && styles.inputFocus, error ? styles.inputError : null, input.style]}
      />
      {hint && !error ? <Text style={styles.hint}>{hint}</Text> : null}
      {error ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Toggle({ label, description, value, onChange, testID, disabled }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void; testID?: string; disabled?: boolean }) {
  return (
    <Pressable role="switch" aria-checked={value} aria-disabled={disabled} accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} accessibilityLabel={label} onPress={() => !disabled && onChange(!value)} style={styles.toggleRow} testID={testID}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {description ? <Text style={styles.hint}>{description}</Text> : null}
      </View>
      <Text style={[styles.toggleState, { color: value ? color.ok : color.muted }]}>{value ? 'オン' : 'オフ'}</Text>
      {/* Visual only: the whole row is the accessible switch (44pt target), so hide the inner control. */}
      <View pointerEvents="none" aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Switch value={value} disabled={disabled} trackColor={{ true: color.primary, false: '#C5CED9' }} tabIndex={-1} />
      </View>
    </Pressable>
  );
}

export function Card({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
    </View>
  );
}

export function Section({ title, children, right, testID }: { title: string; children: ReactNode; right?: ReactNode; testID?: string }) {
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.sectionHead}>
        <T variant="heading" role="heading">
          {title}
        </T>
        {right}
      </View>
      {children}
    </View>
  );
}

export type Tone = 'info' | 'warn' | 'danger' | 'ok' | 'neutral';
const toneStyle: Record<Tone, { bg: string; fg: string; border: string }> = {
  info: { bg: color.primaryTint, fg: color.primaryDeep, border: '#C9D9F2' },
  warn: { bg: color.warnBg, fg: color.warn, border: '#EED7B5' },
  danger: { bg: color.dangerBg, fg: color.danger, border: '#EDC4C8' },
  ok: { bg: color.okBg, fg: color.ok, border: '#BFDCCB' },
  neutral: { bg: '#F0F3F7', fg: color.muted, border: color.line },
};

export function Badge({ label, tone = 'neutral', testID }: { label: string; tone?: Tone; testID?: string }) {
  const t = toneStyle[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg, borderColor: t.border }]} testID={testID}>
      <View style={[styles.badgeDot, { backgroundColor: t.fg }]} aria-hidden importantForAccessibility="no" />
      <Text style={[styles.badgeText, { color: t.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function Banner({ tone = 'info', title, children, testID, action }: { tone?: Tone; title?: string; children?: ReactNode; testID?: string; action?: ReactNode }) {
  const t = toneStyle[tone];
  return (
    <View style={[styles.banner, { backgroundColor: t.bg, borderColor: t.border, borderLeftColor: t.fg }]} accessibilityRole={tone === 'danger' ? 'alert' : undefined} testID={testID}>
      {title ? <Text style={[styles.bannerTitle, { color: t.fg }]}>{title}</Text> : null}
      {typeof children === 'string' ? <Text style={[styles.bannerBody, { color: color.ink }]}>{children}</Text> : children}
      {action ? <View style={{ marginTop: space.sm, flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>{action}</View> : null}
    </View>
  );
}

export function EmptyState({ title, body, action, testID }: { title: string; body?: string; action?: ReactNode; testID?: string }) {
  return (
    <View style={styles.empty} testID={testID}>
      <View style={styles.emptyMark} aria-hidden importantForAccessibility="no-hide-descendants">
        <View style={styles.emptyCardBack} />
        <View style={styles.emptyCardFront}>
          <View style={styles.emptyLineA} />
          <View style={styles.emptyLineB} />
        </View>
      </View>
      <T variant="heading" style={{ textAlign: 'center' }}>{title}</T>
      {body ? <T variant="muted" style={{ textAlign: 'center' }}>{body}</T> : null}
      {action ? <View style={{ marginTop: space.md }}>{action}</View> : null}
    </View>
  );
}

export function Loading({ label = '読み込み中…' }: { label?: string }) {
  return (
    <View style={styles.empty} accessibilityLabel={label} aria-busy>
      <ActivityIndicator color={color.primary} />
      <T variant="muted">{label}</T>
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Banner tone="danger" title="エラー" action={onRetry ? <Button label="再試行" kind="secondary" onPress={onRetry} compact /> : undefined}>
      {message}
    </Banner>
  );
}

export function Screen({ title, subtitle, children, back, actions, testID, narrow, scroll = true }: { title: string; subtitle?: string; children: ReactNode; back?: string | true; actions?: ReactNode; testID?: string; narrow?: boolean; scroll?: boolean }) {
  const router = useRouter();
  const body = (
    <View style={[styles.screenInner, narrow && styles.narrow]}>
      <View style={styles.header}>
        {back ? (
          <Pressable accessibilityRole="button" accessibilityLabel="戻る" onPress={() => (back === true ? (router.canGoBack() ? router.back() : router.replace('/home')) : router.replace(back as never))} style={styles.back} testID="back-button">
            <Text style={styles.backText}>‹ 戻る</Text>
          </Pressable>
        ) : null}
        <View style={styles.headerRow}>
          <View style={{ flex: 1, minWidth: 200 }}>
            <T variant="title" role="heading">
              {title}
            </T>
            {subtitle ? <T variant="muted">{subtitle}</T> : null}
          </View>
          {actions ? <View style={styles.headerActions}>{actions}</View> : null}
        </View>
      </View>
      {children}
    </View>
  );
  return (
    <View style={styles.screen} testID={testID}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </View>
  );
}

export function Row({ children, style, wrap = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; wrap?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

export function KeyValue({ label, value, testID }: { label: string; value?: ReactNode; testID?: string }) {
  return (
    <View style={styles.kv} testID={testID}>
      <Text style={styles.kvLabel}>{label}</Text>
      {typeof value === 'string' || value === undefined ? <Text style={styles.kvValue} selectable>{value || '—'}</Text> : value}
    </View>
  );
}

export function Chip({ label, selected, onPress, testID }: { label: string; selected?: boolean; onPress?: () => void; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={label} onPress={onPress} style={[styles.chip, selected && styles.chipOn]} testID={testID}>
      <Text style={[styles.chipText, selected && { color: color.white }]}>{label}</Text>
    </Pressable>
  );
}

// Initials avatar. Colour is derived from the id (stable, local only) and is decorative: the name is
// always shown as text next to it, so the avatar is hidden from assistive technology.
const AVATAR_TONES = [
  { bg: '#E6ECFA', fg: '#18388C' },
  { bg: '#E4F1EA', fg: '#1B5A3E' },
  { bg: '#F7ECDD', fg: '#7A4810' },
  { bg: '#EFE7F5', fg: '#55307A' },
  { bg: '#E3EEF3', fg: '#1D4E63' },
  { bg: '#F5E6E8', fg: '#82242F' },
] as const;
export function Avatar({ name, id, size = 40 }: { name: string; id: string; size?: number }) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const tone = AVATAR_TONES[h % AVATAR_TONES.length]!;
  const initials = name.replace(/\s+/g, '').slice(0, 1) || '？';
  return (
    <View aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: tone.bg }]}>
      <Text style={[styles.avatarText, { color: tone.fg, fontSize: Math.round(size * 0.42) }]}>{initials}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  text: { color: color.ink, fontFamily: font.family, fontSize: font.body, lineHeight: 24 },
  body: {},
  small: { fontSize: font.small, lineHeight: 19 },
  muted: { color: color.muted, fontSize: 14, lineHeight: 21 },
  label: { fontSize: 12, fontWeight: '700', color: color.muted, letterSpacing: 0.6 },
  title: { fontSize: font.title, fontWeight: '800', lineHeight: 34, letterSpacing: -0.3 },
  heading: { fontSize: font.heading, fontWeight: '700', lineHeight: 26, letterSpacing: -0.1 },
  big: { fontSize: font.big, fontWeight: '800', lineHeight: 38, letterSpacing: -0.5, ...numeric },
  button: { minHeight: MIN_TAP, paddingHorizontal: 18, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: space.sm, borderWidth: 1 },
  buttonCompact: { paddingHorizontal: space.md },
  btn_primary: { backgroundColor: color.primary, borderColor: color.primaryDeep, ...elevation.button },
  btn_secondary: { backgroundColor: color.white, borderColor: color.lineStrong },
  btn_ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  btn_danger: { backgroundColor: color.danger, borderColor: color.danger },
  buttonText: { fontFamily: font.family, fontSize: 15, fontWeight: '700' },
  btnText_primary: { color: color.white },
  btnText_secondary: { color: color.primaryDeep },
  btnText_ghost: { color: color.primary },
  btnText_danger: { color: color.white },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  focus: Platform.select({ web: { outlineStyle: 'solid', outlineWidth: 3, outlineColor: color.focus, outlineOffset: 2 } as ViewStyle, default: {} }),
  field: { gap: 6, marginBottom: space.md },
  fieldLabel: { fontFamily: font.family, fontSize: 14, fontWeight: '700', color: color.ink },
  input: { minHeight: MIN_TAP, borderWidth: 1, borderColor: color.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10, fontSize: font.body, color: color.ink, backgroundColor: color.white, fontFamily: font.family },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  inputFocus: { borderColor: color.primary, ...(Platform.OS === 'web' ? ({ outlineStyle: 'solid', outlineWidth: 2, outlineColor: color.focus } as object) : {}) },
  inputError: { borderColor: color.danger },
  hint: { fontFamily: font.family, fontSize: font.small, color: color.muted, lineHeight: 19 },
  errorText: { fontFamily: font.family, fontSize: 14, color: color.danger, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, minHeight: MIN_TAP, borderBottomWidth: 1, borderBottomColor: color.line },
  toggleLabel: { fontFamily: font.family, fontSize: font.body, fontWeight: '600', color: color.ink },
  toggleState: { fontFamily: font.family, fontSize: 13, fontWeight: '700' },
  card: { backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, padding: 20, gap: space.sm, ...elevation.card },
  section: { gap: space.md, marginBottom: space.xxl },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  badge: { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { flexShrink: 1, fontFamily: font.family, fontSize: 12, fontWeight: '700', lineHeight: 18 },
  banner: { borderWidth: 1, borderLeftWidth: 4, borderRadius: radius.md, paddingVertical: space.md, paddingHorizontal: space.lg, gap: 4, marginBottom: space.md },
  bannerTitle: { fontFamily: font.family, fontSize: 15, fontWeight: '700' },
  bannerBody: { fontFamily: font.family, fontSize: 14, lineHeight: 21 },
  empty: { alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.sm },
  emptyMark: { width: 96, height: 72, marginBottom: space.md },
  emptyCardBack: { position: 'absolute', left: 14, top: 4, width: 74, height: 46, borderRadius: 8, backgroundColor: color.primaryTint, transform: [{ rotate: '-8deg' }] },
  emptyCardFront: { position: 'absolute', left: 8, top: 18, width: 80, height: 50, borderRadius: 8, backgroundColor: color.white, borderWidth: 1, borderColor: color.lineStrong, padding: 10, gap: 6, ...elevation.card },
  emptyLineA: { width: 38, height: 6, borderRadius: 3, backgroundColor: color.primary },
  emptyLineB: { width: 52, height: 5, borderRadius: 3, backgroundColor: color.line },
  avatar: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontFamily: font.family, fontWeight: '700' },
  screen: { flex: 1, backgroundColor: color.bg },
  scrollContent: { flexGrow: 1 },
  screenInner: { width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: 96 },
  narrow: { maxWidth: 560 },
  header: { marginBottom: space.xl, gap: space.xs },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, flexWrap: 'wrap' },
  headerActions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  back: { minHeight: MIN_TAP, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: space.md },
  backText: { fontFamily: font.family, color: color.primary, fontSize: 16, fontWeight: '600' },
  kv: { paddingVertical: 6, gap: 2 },
  kvLabel: { fontFamily: font.family, fontSize: 13, color: color.muted, fontWeight: '600' },
  kvValue: { fontFamily: font.family, fontSize: font.body, color: color.ink },
  chip: { minHeight: MIN_TAP, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: color.lineStrong, backgroundColor: color.white, justifyContent: 'center' },
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  chipText: { fontFamily: font.family, fontSize: 14, color: color.ink, fontWeight: '600' },
});
