import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, RefreshControl, View } from 'react-native';
import type { Goal } from '@onehuman/schemas';
import { goalStatusWord } from '@onehuman/sdk';
import { ReportView } from '@/components/report-view';
import { Badge, Button, Card, Empty, H, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { space } from '@/lib/theme';

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'accent' | 'muted'> = {
  completed: 'success',
  awaiting_plan_approval: 'warning',
  running: 'accent',
  planning: 'accent',
  partially_completed: 'warning',
  failed: 'danger',
};

function GoalRow({ goal }: { goal: Goal }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const decide = useMutation({
    mutationFn: (approved: boolean) => api.goals.decidePlan(goal.id, { approved }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['goals'] }),
  });
  const detail = useQuery({ queryKey: ['goal', goal.id], queryFn: () => api.goals.get(goal.id), enabled: open });
  const reviewing = goal.status === 'awaiting_plan_approval';
  return (
    <Card tone={reviewing ? 'warm' : 'glass'}>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityHint="Shows the report" style={{ gap: space.xs }}>
        <T weight="semibold">{goal.text}</T>
        <Badge tone={TONE[goal.status] ?? 'muted'} label={reviewing ? 'Plan to check' : goalStatusWord(goal.status)} />
      </Pressable>
      {reviewing && goal.plan && (
        <View style={{ gap: space.xs }}>
          <T tone="lead" size="sm">
            {goal.plan.rationale}
          </T>
          {goal.plan.tasks.map((t) => (
            <T key={t.key} size="sm" tone="body">
              • {t.title}
            </T>
          ))}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="Approve plan" style={{ flex: 1 }} onPress={() => decide.mutate(true)} loading={decide.isPending && decide.variables} />
            <Button title="Reject" variant="secondary" style={{ flex: 1 }} onPress={() => decide.mutate(false)} loading={decide.isPending && !decide.variables} />
          </View>
        </View>
      )}
      {!open && goal.summary && !reviewing && (
        <T tone="lead" size="sm" numberOfLines={3}>
          {goal.summary}
        </T>
      )}
      {open && detail.error && (
        <T tone="danger" size="sm">
          {errorMessage(detail.error)}
        </T>
      )}
      {open && detail.data && <ReportView report={detail.data.report} />}
    </Card>
  );
}

/** Agent jobs: the work agents do inside each request, plan reviews on the go, and each job's report. Opened from Pulse. */
export default function GoalsScreen() {
  const goals = useQuery({ queryKey: ['goals'], queryFn: api.goals.list });
  return (
    <Screen refreshControl={<RefreshControl refreshing={goals.isRefetching} onRefresh={() => goals.refetch()} />}>
      <H lead="Agent" title="jobs." />
      <T tone="lead">The work agents do inside each request. Plans that need a look wait here.</T>
      {goals.error && <T tone="danger">{errorMessage(goals.error)}</T>}
      {goals.data?.length === 0 && <Empty title="No agent jobs yet" />}
      {goals.data?.slice(0, 30).map((g) => <GoalRow key={g.id} goal={g} />)}
    </Screen>
  );
}
