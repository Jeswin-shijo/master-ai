import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Animated, View } from 'react-native';
import type { Routine } from '@onehuman/schemas';
import { Badge, Button, Card, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { radius, space, useTheme } from '@/lib/theme';

/** A bar that grows to `value` (0–1) when it appears or changes. */
function ProgressBar({ value, done }: { value: number; done: boolean }) {
  const { c } = useTheme();
  const width = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(width, { toValue: value, useNativeDriver: false, friction: 8, tension: 40 }).start();
  }, [value, width]);
  return (
    <View style={{ height: 8, borderRadius: radius.lg, backgroundColor: c.line10, overflow: 'hidden' }}>
      <Animated.View
        style={{
          height: '100%',
          borderRadius: radius.lg,
          backgroundColor: done ? c.success : c.accent,
          width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
        }}
      />
    </View>
  );
}

function RoutineRow({ r }: { r: Routine }) {
  const queryClient = useQueryClient();
  const run = useMutation({ mutationFn: () => api.routines.run(r.id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routines'] }) });
  const t = r.today;
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <T weight="600" style={{ flex: 1 }}>{r.name}</T>
        {t.calling > 0 ? <Badge tone="primary" label={`Calling ${t.calling}`} /> : <T tone="muted" size="sm">{t.reported}/{t.expected}</T>}
      </View>
      <ProgressBar value={t.expected ? t.reported / t.expected : 0} done={t.expected > 0 && t.reported === t.expected} />
      <T tone="muted" size="xs">{r.mode === 'automatic' ? `AI calls at ${r.time}` : `Filled in by hand, due ${r.time}`}</T>
      {t.flags.slice(0, 3).map((f) => (
        <T key={f} size="sm" tone="danger">! {f}</T>
      ))}
      {t.reported < t.expected && r.status === 'active' && (
        <Button title={r.mode === 'automatic' ? 'Call now' : 'Chase now'} variant="secondary" onPress={() => run.mutate()} loading={run.isPending} />
      )}
      {run.error && <T tone="danger" size="sm">{errorMessage(run.error)}</T>}
    </View>
  );
}

/** Today's routines: who has reported, problems they raised, and a call button. */
export function TodaysCheckins() {
  const routines = useQuery({
    queryKey: ['routines'],
    queryFn: api.routines.list,
    refetchInterval: (q) => (q.state.data?.some((r) => r.today.calling > 0) ? 3000 : false),
  });
  const active = (routines.data ?? []).filter((r) => r.status === 'active');
  if (active.length === 0) return null;
  return (
    <Card>
      <T size="lg" weight="600">Today's check-ins</T>
      {active.map((r) => (
        <RoutineRow key={r.id} r={r} />
      ))}
    </Card>
  );
}
