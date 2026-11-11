import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRef, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type TextProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from './session';

// Slate & Saffron (dark): values mirror packages/ui tokens; kept literal here because React Native has no CSS variables.
export const color = {
  bg: '#0B1016', bg2: '#101821', surface: '#161F29', surface2: '#1C2733', line: '#2A3643', ink: '#F4F6F9', ink2: '#AEB8C4', ink3: '#7D8896',
  accent: '#F5A524', accent2: '#FFC560', accentDeep: '#E07A12', accentText: '#1A1405', danger: '#FF7B7B', ok: '#5FD3A0', info: '#8CC2FF', violet: '#C49CFF',
};
export const gradient = {
  accent: ['#FFC560', '#F5A524', '#E8891A'] as const,
  screen: ['#121C27', '#0B1016', '#0B1016'] as const,
  hero: ['#25384A', '#16222E', '#0B1016'] as const,
};
export type IconName = ComponentProps<typeof Ionicons>['name'];
export const Icon = ({ name, size = 22, tint = color.ink }: { name: IconName; size?: number; tint?: string }) => <Ionicons name={name} size={size} color={tint} />;

/** Text that follows the language's reading direction; numbers are forced left-to-right so amounts and dates never flip. */
export function T({ children, style, ltr, ...p }: TextProps & { ltr?: boolean }) {
  const { rtl } = useApp();
  return <Text {...p} style={[{ color: color.ink, fontSize: 16, textAlign: rtl && !ltr ? 'right' : 'left', writingDirection: ltr ? 'ltr' : rtl ? 'rtl' : 'ltr' }, style]}>{children}</Text>;
}
export const Muted = (p: TextProps & { ltr?: boolean }) => <T {...p} style={[{ color: color.ink2, fontSize: 14 }, p.style]} />;
export const H1 = (p: TextProps) => <T {...p} style={[{ fontSize: 28, fontWeight: '800', letterSpacing: -0.4 }, p.style]} />;
export const H2 = (p: TextProps) => <T {...p} style={[{ fontSize: 19, fontWeight: '800' }, p.style]} />;

/** A pressable that gently shrinks under the finger (native driver, so it stays smooth on cheap phones). */
export function Press({ children, onPress, disabled, style, label, outer }: { children: ReactNode; onPress?: () => void; disabled?: boolean; style?: ViewStyle | ViewStyle[]; label?: string; outer?: ViewStyle }) {
  const v = useRef(new Animated.Value(1)).current;
  const to = (x: number) => Animated.spring(v, { toValue: x, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} onPressIn={() => to(0.97)} onPressOut={() => to(1)} style={outer}>
      <Animated.View style={[{ transform: [{ scale: v }] }, disabled ? { opacity: 0.5 } : null, style]}>{children}</Animated.View>
    </Pressable>
  );
}

/** Background for every screen: the night sky (stars, moon, ridges) with a soft warm glow, inside the safe area. */
export function Screen({ children }: { children: ReactNode }) {
  // Tab screens are see-through (the night sky is drawn ONCE behind the whole app, app/_layout.tsx), so a tab that is not in front must
  // be hidden or earlier tabs show through the current one (seen on the browser build; phones detach them, this makes it certain).
  const focused = useIsFocused();
  return (
    <View style={{ flex: 1, display: focused ? 'flex' : 'none' }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>{children}</SafeAreaView>
    </View>
  );
}

/** Screen title block: small eyebrow (school name), big title, optional subtitle and a right-hand icon. */
export function Header({ eyebrow, title, subtitle, right }: { eyebrow?: string; title: string; subtitle?: string; right?: ReactNode }) {
  const { rtl } = useApp();
  return (
    <View style={[st.header, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
      <View style={{ flex: 1, gap: 2 }}>
        {eyebrow ? <T style={{ color: color.accent, fontWeight: '700', fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase' }}>{eyebrow}</T> : null}
        <H1>{title}</H1>
        {subtitle ? <Muted>{subtitle}</Muted> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({ children, style, accent }: { children: ReactNode; style?: ViewStyle; accent?: boolean }) {
  return (
    <View style={[st.card, accent ? { borderColor: 'rgba(245,165,36,0.45)' } : null, style]}>
      {accent ? <LinearGradient colors={['rgba(245,165,36,0.14)', 'rgba(245,165,36,0)']} style={[StyleSheet.absoluteFill, { borderRadius: 20 }]} /> : null}
      {children}
    </View>
  );
}

export function Button({ label, onPress, disabled, secondary, icon, danger }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; icon?: IconName; danger?: boolean }) {
  const ink = secondary ? (danger ? color.danger : color.ink) : color.accentText;
  const inner = (
    <View style={st.btnInner}>
      {icon ? <Icon name={icon} size={19} tint={ink} /> : null}
      <Text style={{ color: ink, fontWeight: '800', fontSize: 16 }}>{label}</Text>
    </View>
  );
  return (
    <Press onPress={onPress} disabled={disabled} label={label} style={secondary ? [st.btn, st.btnSecondary] : [st.btn, st.btnShadow]}>
      {secondary ? inner : <LinearGradient colors={gradient.accent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 16 }]} />}
      {secondary ? null : inner}
    </Press>
  );
}

/** Labelled input with a leading icon; `ltr` for emails, codes and numbers. */
export function Field({ label, icon, ltr, ...p }: TextInputProps & { label: string; icon?: IconName; ltr?: boolean }) {
  const { rtl } = useApp();
  return (
    <View style={{ gap: 6 }}>
      <Muted style={{ fontWeight: '700' }}>{label}</Muted>
      <View style={[st.field, { flexDirection: rtl && !ltr ? 'row-reverse' : 'row' }]}>
        {icon ? <Icon name={icon} size={20} tint={color.ink3} /> : null}
        <TextInput placeholderTextColor={color.ink3} accessibilityLabel={label} {...p}
          style={[{ flex: 1, color: color.ink, fontSize: 17, paddingVertical: 12 }, ltr ? { writingDirection: 'ltr', textAlign: 'left' } : { textAlign: rtl ? 'right' : 'left' }, p.style]} />
      </View>
    </View>
  );
}

/** Round avatar with initials on a warm gradient. */
export function Avatar({ name, size = 46 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  return (
    <LinearGradient colors={gradient.accent} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: color.accentText, fontWeight: '900', fontSize: size * 0.38 }}>{initials}</Text>
    </LinearGradient>
  );
}

/** Small coloured status label. */
export function Chip({ label, tint = color.accent }: { label: string; tint?: string }) {
  return <View style={[st.chip, { borderColor: tint, backgroundColor: `${tint}22` }]}><Text style={{ color: tint, fontWeight: '800', fontSize: 12 }}>{label}</Text></View>;
}

/** Thin progress bar (0..1). */
export function Bar({ value, tint = color.ok }: { value: number; tint?: string }) {
  return <View style={st.track}><View style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: '100%', backgroundColor: tint, borderRadius: 4 }} /></View>;
}

/** Square-ish tile with an icon on a tinted circle: used for quick actions on Home. */
export function Tile({ icon, label, tint = color.accent, onPress }: { icon: IconName; label: string; tint?: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} label={label} style={st.tile} outer={{ flexBasis: '47%', flexGrow: 1 }}>
      <View style={[st.tileIc, { backgroundColor: `${tint}22` }]}><Icon name={icon} size={24} tint={tint} /></View>
      <Text style={{ color: color.ink, fontWeight: '800', fontSize: 14 }} numberOfLines={1}>{label}</Text>
    </Press>
  );
}

export const Loading = () => <View style={{ padding: 32 }}><ActivityIndicator color={color.accent} size="large" /></View>;
export const ErrorText = ({ children }: { children: ReactNode }) => (
  <View style={st.alert}><Icon name="alert-circle" size={18} tint={color.danger} /><T accessibilityRole="alert" style={{ color: color.danger, flex: 1 }}>{children}</T></View>
);
export const Notice = ({ children, tint = color.ok, icon = 'checkmark-circle' as IconName }: { children: ReactNode; tint?: string; icon?: IconName }) => (
  <View style={[st.alert, { borderColor: `${tint}66`, backgroundColor: `${tint}14` }]}><Icon name={icon} size={18} tint={tint} /><T accessibilityRole="alert" style={{ color: tint, flex: 1, fontWeight: '700' }}>{children}</T></View>
);
export const Empty = ({ icon = 'sparkles-outline' as IconName, text }: { icon?: IconName; text: string }) => (
  <View style={{ alignItems: 'center', padding: 28, gap: 10 }}><Icon name={icon} size={40} tint={color.ink3} /><Muted style={{ textAlign: 'center' }}>{text}</Muted></View>
);

const st = StyleSheet.create({
  orb: { position: 'absolute', width: 340, height: 340, borderRadius: 170 },
  header: { alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 4 },
  card: { backgroundColor: 'rgba(22,31,41,0.92)', borderColor: color.line, borderWidth: 1, borderRadius: 20, padding: 16, gap: 8, overflow: 'hidden' },
  btn: { borderRadius: 16, minHeight: 52, justifyContent: 'center', overflow: 'hidden' },
  btnShadow: { shadowColor: '#F5A524', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  btnSecondary: { backgroundColor: 'rgba(28,39,51,0.9)', borderWidth: 1, borderColor: color.line },
  btnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 20 },
  field: { alignItems: 'center', gap: 10, backgroundColor: color.bg2, borderColor: color.line, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, minHeight: 52 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  track: { height: 7, borderRadius: 4, backgroundColor: color.surface2, overflow: 'hidden' },
  tile: { backgroundColor: 'rgba(22,31,41,0.92)', borderColor: color.line, borderWidth: 1, borderRadius: 20, padding: 16, gap: 12 },
  tileIc: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: 'rgba(255,123,123,0.4)', backgroundColor: 'rgba(255,123,123,0.08)', borderRadius: 14, padding: 12 },
});

// legacy names some screens still use
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  pad: { padding: 18, gap: 14, paddingBottom: 40 },
  card: st.card,
  btn: st.btn,
  btnSecondary: st.btnSecondary,
  input: { backgroundColor: color.bg2, borderColor: color.line, borderWidth: 1, borderRadius: 14, padding: 12, color: color.ink, fontSize: 18, minHeight: 52 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});
