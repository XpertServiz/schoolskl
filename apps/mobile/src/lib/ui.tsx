import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type TextProps } from 'react-native';
import { useApp } from './session';

// Slate & Saffron (dark): values mirror packages/ui tokens; kept literal here because React Native has no CSS variables.
export const color = { bg: '#0F1419', surface: '#1A2129', line: '#2B3540', ink: '#F2F4F7', ink2: '#B4BDC8', accent: '#F5A524', accentText: '#1A1405', danger: '#FF7B7B', ok: '#5FD3A0' };

/** Text that follows the language's reading direction; numbers are forced left-to-right so amounts and dates never flip. */
export function T({ children, style, ltr, ...p }: TextProps & { ltr?: boolean }) {
  const { rtl } = useApp();
  return <Text {...p} style={[{ color: color.ink, fontSize: 16, textAlign: rtl && !ltr ? 'right' : 'left', writingDirection: ltr ? 'ltr' : rtl ? 'rtl' : 'ltr' }, style]}>{children}</Text>;
}

export const Muted = (p: TextProps & { ltr?: boolean }) => <T {...p} style={[{ color: color.ink2, fontSize: 14 }, p.style]} />;

export function Card({ children }: { children: ReactNode }) {
  return <View style={s.card}>{children}</View>;
}

export function Button({ label, onPress, disabled, secondary }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled}
      style={[s.btn, secondary && s.btnSecondary, disabled && { opacity: 0.5 }]}>
      <Text style={{ color: secondary ? color.ink : color.accentText, fontWeight: '700', fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

export const Loading = () => <View style={{ padding: 32 }}><ActivityIndicator color={color.accent} /></View>;
export const ErrorText = ({ children }: { children: ReactNode }) => <T accessibilityRole="alert" style={{ color: color.danger }}>{children}</T>;

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  pad: { padding: 16, gap: 12 },
  card: { backgroundColor: color.surface, borderColor: color.line, borderWidth: 1, borderRadius: 16, padding: 16, gap: 6 },
  btn: { backgroundColor: color.accent, paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  btnSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.line },
  input: { backgroundColor: color.bg, borderColor: color.line, borderWidth: 1, borderRadius: 12, padding: 12, color: color.ink, fontSize: 18, minHeight: 48 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});
