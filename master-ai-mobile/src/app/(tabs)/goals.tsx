import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import type { Goal } from '@onehuman/schemas';
import { goalStatusWord } from '@onehuman/sdk';
import { ReportView } from '@/components/report-view';
import { Badge, Button, Card, Empty, Screen, T } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { radius, space, useTheme } from '@/lib/theme';

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'primary' | 'muted'> = {
  completed: 'success',
  awaiting_plan_approval: 'warning',
  running: 'primary',
  planning: 'primary',
  partially_completed: 'warning',
  failed: 'danger',
};

/** Give the company a goal and review plans on the go. */
export default function GoalsScreen() {
  const { c } = useTheme();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const goals = useQuery({ queryKey: ['goals'], queryFn: api.goals.list });
  const create = useMutation({
    mutationFn: () => api.goals.create({ text }),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: ['goals'] });
    },
  });

  return (
    <Screen refreshControl={<RefreshControl refreshing={goals.isRefetching} onRefresh={() => goals.refetch()} />}>
      <T size="xxl" weight="700">Goals</T>
      <Card>
        <TextInput
          style={[styles.input, { borderColor: c.border, color: c.text }]}
          placeholder="What should the company get done?"
          placeholderTextColor={c.textMuted}
          value={text}
          onChangeText={setText}
          multiline
        />
        {create.error && <T tone="danger" size="sm">{errorMessage(create.error)}</T>}
        <Button title="Send to orchestrator" onPress={() => create.mutate()} loading={create.isPending} disabled={text.trim().length < 3} />
      </Card>
      {goals.data?.length === 0 && <Empty title="No goals yet" />}
      {goals.data?.slice(0, 30).map((g) => <GoalRow key={g.id} goal={g} />)}
    </Screen>
  );
}

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
    <Card>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityHint="Shows the report" style={{ gap: space.xs }}>
        <T weight="600">{goal.text}</T>
        <Badge tone={TONE[goal.status] ?? 'muted'} label={goal.status === 'awaiting_plan_approval' ? 'Plan review' : goalStatusWord(goal.status)} />
      </Pressable>
      {reviewing && goal.plan && (
        <View style={{ gap: space.xs }}>
          <T tone="muted" size="sm">{goal.plan.rationale}</T>
          {goal.plan.tasks.map((t) => (
            <T key={t.key} size="sm">• {t.title}</T>
          ))}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="Approve plan" variant="success" style={{ flex: 1 }} onPress={() => decide.mutate(true)} loading={decide.isPending && decide.variables} />
            <Button title="Reject" variant="secondary" style={{ flex: 1 }} onPress={() => decide.mutate(false)} loading={decide.isPending && !decide.variables} />
          </View>
        </View>
      )}
      {!open && goal.summary && !reviewing && (
        <T tone="muted" size="sm" numberOfLines={3}>
          {goal.summary}
        </T>
      )}
      {open && detail.error && <T tone="danger" size="sm">{errorMessage(detail.error)}</T>}
      {open && detail.data && <ReportView report={detail.data.report} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: space.md, minHeight: 72, fontSize: 16, textAlignVertical: 'top' },
});
