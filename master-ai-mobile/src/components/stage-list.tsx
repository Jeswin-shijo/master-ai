import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import type { CaseReport, StageKey } from '@onehuman/schemas';
import { dotLabel, showStageSummary, stagePulses, type DotState } from '@onehuman/sdk';
import { T } from '@/components/ui';
import { radius, space, useTheme } from '@/lib/theme';

function took(minutes: number): string {
  return minutes < 60 ? `${Math.max(1, Math.round(minutes))} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} days`;
}

/** The requester's own words, behind a tap: they can be long, and they are only ever text. */
function TheirWords({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)} style={{ minHeight: 44, justifyContent: 'center' }}>
        <T tone="accent" size="sm">
          {open ? 'Hide their own words' : 'Their own words'}
        </T>
      </Pressable>
      {open && (
        <T tone="body" size="sm" selectable>
          {text}
        </T>
      )}
    </View>
  );
}

function StageRow({ n, row, state, lines, last, requestText }: { n: number; row: CaseReport['stages'][number]; state: DotState; lines: string[]; last: boolean; requestText?: string }) {
  const { c } = useTheme();
  const reduced = useReducedMotion();
  const pulses = stagePulses(state, reduced);
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (pulses) {
      pulse.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false));
    } else {
      cancelAnimation(pulse);
      pulse.set(0);
    }
  }, [pulses, pulse]);
  const halo = useAnimatedStyle(() => ({ opacity: 0.8 * (1 - pulse.get()), transform: [{ scale: 1 + 0.45 * pulse.get() }] }));
  const look = {
    done: { bg: c.successSoft, fg: c.success, border: c.success, label: c.success },
    live: { bg: c.node, fg: c.text, border: c.glow, label: c.textBody },
    waiting: { bg: c.warningSoft, fg: c.warning, border: c.warning, label: c.warning },
    todo: { bg: 'transparent', fg: c.textMuted, border: c.line20, label: c.textMuted },
    skipped: { bg: c.line5, fg: c.textMuted, border: c.line10, label: c.textMuted },
    stopped: { bg: c.dangerSoft, fg: c.danger, border: c.danger, label: c.danger },
  }[state];

  return (
    <View style={{ flexDirection: 'row', gap: space.md }} testID={`stage-${row.stage}`}>
      <View style={{ alignItems: 'center', width: 36 }}>
        {/* The node carries the stage's state in words, for screen readers and the phone tests. */}
        <View style={{ width: 34, height: 34 }} accessible accessibilityLabel={`${n}. ${row.name}: ${dotLabel(state)}`}>
          {(state === 'live' || state === 'waiting') && (
            // The halo pulses while the stage works or waits; with reduced motion it is a still ring.
            <Animated.View style={[styles.halo, { borderColor: state === 'waiting' ? c.warning : c.glow }, pulses ? halo : styles.still]} />
          )}
          <View style={[styles.node, { backgroundColor: look.bg, borderColor: look.border, borderStyle: state === 'todo' ? 'dashed' : 'solid' }]}>
            {state === 'done' ? (
              <Ionicons name="checkmark" size={18} color={c.success} />
            ) : (
              <T size="sm" weight="semibold" style={{ color: look.fg }}>
                {n}
              </T>
            )}
          </View>
        </View>
        {!last && <View style={{ flex: 1, width: 1.5, marginVertical: 4, backgroundColor: state === 'done' ? c.success : c.line10 }} />}
      </View>
      <View style={{ flex: 1, gap: 4, paddingBottom: last ? 0 : space.lg }}>
        <T weight="medium">{row.name}</T>
        <T size="sm" style={{ color: look.label }}>
          {dotLabel(state)}
          {row.minutes !== null && state === 'done' ? ` · ${took(row.minutes)}` : ''}
        </T>
        {row.summary && showStageSummary(state, lines.length) ? (
          <T size="sm" tone="body">
            {row.summary}
          </T>
        ) : null}
        {lines.map((line, j) => (
          <T key={j} size="sm" tone="lead">
            {line}
          </T>
        ))}
        {requestText ? <TheirWords text={requestText} /> : null}
      </View>
    </View>
  );
}

/** The 8 stages top to bottom: green ticks behind, the current stage pulsing, the case file under each. */
export function StageList({ rows, states, lines, requestText }: { rows: CaseReport['stages']; states: DotState[]; lines: Partial<Record<StageKey, string[]>>; requestText?: string }) {
  return (
    <View>
      {rows.map((row, i) => (
        <StageRow
          key={row.stage}
          n={i + 1}
          row={row}
          state={states[i] ?? 'todo'}
          lines={lines[row.stage] ?? []}
          last={i === rows.length - 1}
          requestText={row.stage === 'request' ? requestText : undefined}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  node: { width: 34, height: 34, borderRadius: radius.sm, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: radius.md, borderWidth: 1.5 },
  still: { opacity: 0.45, transform: [{ scale: 1.08 }] },
});
