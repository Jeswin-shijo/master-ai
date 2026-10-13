import type { ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type ScrollViewProps,
  type TextInputProps,
  type TextProps,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { dotLabel, type DotState } from '@onehuman/sdk';
import { font, fontSize, gradients, radius, space, useTheme } from '@/lib/theme';

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
      {/* The web's soft glows, as one cheap fade from the top: blur is slow on Android. */}
      <LinearGradient pointerEvents="none" colors={[c.accentSoft, c.background] as const} style={styles.glow} />
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

type Tone = 'default' | 'body' | 'lead' | 'muted' | 'accent' | 'primary' | 'success' | 'warning' | 'danger';
type Weight = 'regular' | 'medium' | 'semibold' | '400' | '500' | '600' | '700';

const FAMILY: Record<Weight, string> = {
  regular: font.text,
  '400': font.text,
  medium: font.medium,
  '500': font.medium,
  semibold: font.semibold,
  '600': font.semibold,
  '700': font.semibold,
};

/** Text in Red Hat Text. Weights pick a font family; fontWeight would drop the font on Android. */
export function T({ tone = 'default', size = 'md', weight = 'regular', style, ...props }: TextProps & { tone?: Tone; size?: keyof typeof fontSize; weight?: Weight }) {
  const { c } = useTheme();
  const color = { default: c.text, body: c.textBody, lead: c.textLead, muted: c.textMuted, accent: c.accent, primary: c.accent, success: c.success, warning: c.warning, danger: c.danger }[tone];
  return <Text style={[{ color, fontSize: fontSize[size], fontFamily: FAMILY[weight] }, style]} {...props} />;
}

/** A two-tone heading in Red Hat Display: a grey lead-in and a white payoff. */
export function H({ lead, title, size = 'xxl' }: { lead?: string; title: string; size?: 'xl' | 'xxl' | 'hero' }) {
  const { c } = useTheme();
  return (
    <Text accessibilityRole="header" style={{ fontFamily: font.displayLight, fontSize: fontSize[size], lineHeight: Math.round(fontSize[size] * 1.18), color: c.text }}>
      {lead ? <Text style={{ color: c.textLead }}>{lead} </Text> : null}
      {title}
    </Text>
  );
}

/** A glass card; `warm` when it holds something a person must do. */
export function Card({ style, tone = 'glass', ...props }: ViewProps & { tone?: 'glass' | 'warm' }) {
  const { c } = useTheme();
  const warm = tone === 'warm';
  return <View style={[styles.card, { backgroundColor: warm ? c.warningSoft : c.surface, borderColor: warm ? c.warning : c.line10 }, style]} {...props} />;
}

type Variant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';

/** `primary` is the warm action gradient with a white label; the rest are soft and outlined. */
export function Button({
  title,
  variant = 'primary',
  icon,
  loading,
  disabled,
  style,
  ...props
}: PressableProps & { title: string; variant?: Variant; icon?: ReactNode; loading?: boolean }) {
  const { c } = useTheme();
  const soft = {
    secondary: { bg: c.line10, fg: c.text, border: c.line10 },
    danger: { bg: c.dangerSoft, fg: c.danger, border: c.danger },
    success: { bg: c.successSoft, fg: c.success, border: c.success },
    ghost: { bg: 'transparent', fg: c.textBody, border: 'transparent' },
  } as const;
  const fg = variant === 'primary' ? c.onAction : soft[variant].fg;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading}
      style={(state) => [
        styles.button,
        variant !== 'primary' && { backgroundColor: soft[variant].bg, borderColor: soft[variant].border, borderWidth: StyleSheet.hairlineWidth },
        { opacity: disabled ? 0.5 : state.pressed ? 0.85 : 1 },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...props}
    >
      {variant === 'primary' && (
        <LinearGradient colors={gradients.action.colors} locations={gradients.action.locations} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      )}
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text style={{ color: fg, fontSize: fontSize.md, fontFamily: font.semibold }}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

type BadgeTone = 'default' | 'muted' | 'accent' | 'primary' | 'success' | 'warning' | 'danger';

export function Badge({ label, tone = 'muted' }: { label: string; tone?: BadgeTone }) {
  const { c } = useTheme();
  const map: Record<BadgeTone, [string, string]> = {
    default: [c.line10, c.text],
    muted: [c.line5, c.textLead],
    accent: [c.accentSoft, c.accent],
    primary: [c.accentSoft, c.accent],
    success: [c.successSoft, c.success],
    warning: [c.warningSoft, c.warning],
    danger: [c.dangerSoft, c.danger],
  };
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.full, paddingHorizontal: space.sm, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: fontSize.xs, fontFamily: font.semibold }}>{label}</Text>
    </View>
  );
}

/** A filter or choice, 44px tall. */
export function Pill({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      testID={testID}
      style={{
        minHeight: 44,
        paddingHorizontal: space.md,
        borderRadius: radius.full,
        justifyContent: 'center',
        backgroundColor: active ? c.accentSoft : c.line5,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: active ? c.accent : c.line10,
      }}
    >
      <Text style={{ color: active ? c.text : c.textLead, fontFamily: font.medium, fontSize: fontSize.sm }}>{label}</Text>
    </Pressable>
  );
}

export function Input({ style, ...props }: TextInputProps) {
  const { c } = useTheme();
  return (
    <TextInput
      placeholderTextColor={c.textMuted}
      {...props}
      style={[styles.input, { borderColor: c.line10, color: c.text, backgroundColor: c.line5, fontFamily: font.text }, style]}
    />
  );
}

/** The 8 stages as dots: green done, warm waiting, glowing live, dashed not started. Read out in words. */
export function StageDots({ states, names }: { states: DotState[]; names: string[] }) {
  const { c } = useTheme();
  const fill: Record<DotState, ViewStyle> = {
    done: { backgroundColor: c.success },
    live: { backgroundColor: c.glow },
    waiting: { backgroundColor: c.warning },
    todo: { borderWidth: 1, borderStyle: 'dashed', borderColor: c.line20 },
    skipped: { backgroundColor: c.line15 },
    stopped: { backgroundColor: c.danger },
  };
  return (
    <View accessible accessibilityLabel={states.map((s, i) => `${names[i]}: ${dotLabel(s)}`).join(', ')} style={{ flexDirection: 'row', gap: 5 }}>
      {states.map((s, i) => (
        <View key={i} style={[styles.dot, fill[s]]} />
      ))}
    </View>
  );
}

export function RiskBar({ score }: { score: number }) {
  const { c } = useTheme();
  const color = score < 35 ? c.level2 : score < 75 ? c.level3 : c.level4;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }} accessibilityLabel={`Risk score ${score}`}>
      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: c.line10, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(3, score)}%`, height: 6, backgroundColor: color }} />
      </View>
      <T size="xs" tone="muted">risk {score}</T>
    </View>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.xs }}>
      <T weight="semibold">{title}</T>
      {children && (
        <T tone="lead" style={{ textAlign: 'center' }}>
          {children}
        </T>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 280 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  button: { minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: 48, fontSize: fontSize.md },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
