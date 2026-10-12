import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type ScrollViewProps,
  type TextProps,
  type ViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fontSize, radius, space, useTheme } from '@/lib/theme';

export function Screen({
  children,
  scroll = true,
  underHeader = false,
  ...props
}: ScrollViewProps & { scroll?: boolean; underHeader?: boolean; children: ReactNode }) {
  const { c } = useTheme();
  return (
    // Screens below a navigation header already sit under the status bar.
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }} edges={underHeader ? [] : ['top']}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }} {...props}>
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, padding: space.lg, gap: space.md }}>{children}</View>
      )}
    </SafeAreaView>
  );
}

type Tone = 'default' | 'muted' | 'primary' | 'success' | 'warning' | 'danger';

export function T({ tone = 'default', size = 'md', weight, style, ...props }: TextProps & { tone?: Tone; size?: keyof typeof fontSize; weight?: '400' | '500' | '600' | '700' }) {
  const { c } = useTheme();
  const color = { default: c.text, muted: c.textMuted, primary: c.primary, success: c.success, warning: c.warning, danger: c.danger }[tone];
  return <Text style={[{ color, fontSize: fontSize[size], fontWeight: weight }, style]} {...props} />;
}

export function Card({ style, ...props }: ViewProps) {
  const { c } = useTheme();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, style]} {...props} />;
}

export function Button({
  title,
  variant = 'primary',
  loading,
  disabled,
  style,
  ...props
}: PressableProps & { title: string; variant?: 'primary' | 'secondary' | 'danger' | 'success'; loading?: boolean }) {
  const { c } = useTheme();
  const bg = { primary: c.primary, secondary: c.surfaceMuted, danger: c.danger, success: c.success }[variant];
  const fg = variant === 'secondary' ? c.text : variant === 'primary' ? c.primaryText : '#ffffff';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={(state) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : state.pressed ? 0.85 : 1 },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...props}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: fontSize.md, fontWeight: '600' }}>{title}</Text>}
    </Pressable>
  );
}

export function Badge({ label, tone = 'muted' }: { label: string; tone?: Tone }) {
  const { c } = useTheme();
  const map = {
    default: [c.surfaceMuted, c.text],
    muted: [c.surfaceMuted, c.textMuted],
    primary: [c.primarySoft, c.primary],
    success: [c.successSoft, c.success],
    warning: [c.warningSoft, c.warning],
    danger: [c.dangerSoft, c.danger],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.full, paddingHorizontal: space.sm, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: fontSize.xs, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

export function RiskBar({ score }: { score: number }) {
  const { c } = useTheme();
  const color = score < 35 ? c.level2 : score < 75 ? c.level3 : c.level4;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }} accessibilityLabel={`Risk score ${score}`}>
      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: c.surfaceMuted, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(3, score)}%`, height: 6, backgroundColor: color }} />
      </View>
      <T size="xs" tone="muted">risk {score}</T>
    </View>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.xs }}>
      <T weight="600">{title}</T>
      {children && <T tone="muted" style={{ textAlign: 'center' }}>{children}</T>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  button: { minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
});
