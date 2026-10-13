import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pressable, RefreshControl, View } from 'react-native';
import type { CallStage, Delegation } from '@onehuman/schemas';
import { Badge, Card, Empty, H, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { radius, space, useTheme } from '@/lib/theme';

const STAGES: { key: CallStage; label: string }[] = [
  { key: 'assign', label: 'Assign' },
  { key: 'follow_up', label: 'Follow-up' },
  { key: 'confirm', label: 'Confirm' },
];

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'primary' | 'muted'> = {
  done: 'success',
  accepted: 'primary',
  in_progress: 'primary',
  assigning: 'primary',
  declined: 'danger',
  blocked: 'danger',
  not_done: 'danger',
  unreachable: 'warning',
};

/** Work handed to the team by phone: who has it, which call happened, what they said. */
export default function CallsScreen() {
  const delegations = useQuery({ queryKey: ['delegations', 'all'], queryFn: () => api.delegations.list() });
  return (
    <Screen refreshControl={<RefreshControl refreshing={delegations.isRefetching} onRefresh={() => delegations.refetch()} />}>
      <H lead="Calls with" title="your team." />
      <T tone="lead">Work handed to your team by phone: assign, follow up, confirm.</T>
      {delegations.error && <T tone="danger">{errorMessage(delegations.error)}</T>}
      {delegations.data?.length === 0 && <Empty title="No calls yet">Work handed to people by phone shows up here.</Empty>}
      {delegations.data?.map((d) => <DelegationRow key={d.id} d={d} />)}
    </Screen>
  );
}

function DelegationRow({ d }: { d: Delegation }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const last = d.calls[d.calls.length - 1];
  return (
    <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
          <T tone="muted" size="xs">{d.staffName} · {d.staffTitle}</T>
          <Badge tone={TONE[d.status] ?? 'muted'} label={d.status.replace(/_/g, ' ')} />
        </View>
        <T weight="600">{d.title}</T>
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          {STAGES.map(({ key, label }) => {
            const calls = d.calls.filter((x) => x.stage === key);
            const done = calls.some((x) => x.status === 'completed');
            const active = d.stage === key;
            return (
              <View
                key={key}
                style={{
                  flex: 1,
                  borderRadius: radius.md,
                  paddingVertical: 6,
                  alignItems: 'center',
                  backgroundColor: done ? c.successSoft : active ? c.infoSoft : c.line5,
                }}
              >
                <T size="xs" weight="600" tone={done ? 'success' : active ? 'primary' : 'muted'}>{label}</T>
              </View>
            );
          })}
        </View>
        {(d.outcome?.summary ?? last?.summary) && <T tone="muted" size="sm">{d.outcome?.summary ?? last?.summary}</T>}
        {open &&
          d.calls.map((call) => (
            <View key={call.id} style={{ gap: 4, marginTop: space.sm }}>
              <T size="xs" weight="600" tone="muted">
                {STAGES.find((s) => s.key === call.stage)?.label} call{call.attempt > 1 ? ` · attempt ${call.attempt}` : ''} · {call.outcome?.replace(/_/g, ' ') ?? call.status}
              </T>
              {call.transcript.map((l, i) => (
                <View
                  key={i}
                  style={{
                    alignSelf: l.speaker === 'person' ? 'flex-end' : 'flex-start',
                    maxWidth: '88%',
                    backgroundColor: l.speaker === 'person' ? c.line5 : c.accentSoft,
                    borderRadius: radius.lg,
                    paddingHorizontal: space.md,
                    paddingVertical: space.xs + 2,
                  }}
                >
                  <T size="sm">{l.text}</T>
                </View>
              ))}
            </View>
          ))}
      </Card>
    </Pressable>
  );
}
