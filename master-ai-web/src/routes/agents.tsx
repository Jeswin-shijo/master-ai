import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Bot, Pause, Play, Undo2 } from 'lucide-react';
import type { AgentView, AutonomySuggestion } from '@onehuman/schemas';
import { AUTONOMY_LEVELS } from '@onehuman/schemas';
import { StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { formatInr } from '@/lib/utils';

function AgentCard({ agent, suggestions }: { agent: AgentView; suggestions: AutonomySuggestion[] }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['agents'] });
  const toggle = useMutation({ mutationFn: () => (agent.status === 'paused' ? api.agents.resume(agent.id) : api.agents.pause(agent.id)), onSuccess: refresh });
  const setClearance = useMutation({ mutationFn: (autonomy: 1 | 2 | 3 | 4) => api.agents.update(agent.id, { autonomy }), onSuccess: refresh });
  const grant = useMutation({ mutationFn: (tool: string) => api.agents.addOverride(agent.id, { tool, level: 3 }), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: (overrideId: string) => api.agents.removeOverride(agent.id, overrideId), onSuccess: refresh });
  const budgets = agent.spec.budgets;

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Bot className="size-4 text-primary" aria-hidden /> {agent.name}
          </span>
        }
        description={agent.description}
        action={<StatusBadge status={agent.status} />}
      />
      <CardBody className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-fg-muted">Tasks done</dt><dd className="font-semibold tabular-nums">{agent.stats.tasksCompleted}</dd></div>
          <div><dt className="text-xs text-fg-muted">Approvals asked</dt><dd className="font-semibold tabular-nums">{agent.stats.approvalsRequested}</dd></div>
          <div><dt className="text-xs text-fg-muted">Rejected</dt><dd className="font-semibold tabular-nums">{agent.stats.approvalsRejected}</dd></div>
          <div><dt className="text-xs text-fg-muted">AI spend</dt><dd className="font-semibold tabular-nums">{formatInr(agent.stats.spendInr)}</dd></div>
        </dl>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-fg-muted" htmlFor={`clearance-${agent.id}`}>Clearance</label>
          <Select
            id={`clearance-${agent.id}`}
            className="w-auto"
            value={agent.autonomy}
            onChange={(e) => setClearance.mutate(Number(e.target.value) as 1 | 2 | 3 | 4)}
          >
            {([1, 2, 3, 4] as const).map((l) => (
              <option key={l} value={l}>L{l} · {AUTONOMY_LEVELS[l].name}</option>
            ))}
          </Select>
          <span className="text-xs text-fg-muted">
            {agent.model.tier} model · {agent.model.dataClass} data · {budgets.max_steps} steps · {budgets.tokens_per_task.toLocaleString('en-IN')} tokens/task · {formatInr(budgets.money_per_task_inr)} spend/task
          </span>
        </div>

        <div className="flex flex-wrap gap-1">
          {agent.tools.map((t) => {
            const override = agent.overrides.find((o) => o.tool === t);
            return (
              <code key={t} className={override ? 'rounded bg-success-soft px-1.5 py-0.5 text-[11px] text-success' : 'rounded bg-muted px-1.5 py-0.5 text-[11px] text-fg-muted'} title={override ? `Earned autonomy: L${override.level}` : undefined}>
                {t}
              </code>
            );
          })}
        </div>

        {suggestions.map((s) => (
          <div key={s.tool} className="flex flex-wrap items-center gap-3 rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm">
            <Award className="size-4 text-success" aria-hidden />
            <span className="flex-1 text-fg">
              You approved <code>{s.tool}</code> {s.consecutiveCleanApprovals} times in a row without changes. Let {agent.name} do it without asking (Level 3)?
            </span>
            <Button size="sm" variant="success" onClick={() => grant.mutate(s.tool)} loading={grant.isPending}>Grant</Button>
          </div>
        ))}

        {agent.overrides.map((o) => (
          <div key={o.id} className="flex items-center gap-3 text-sm text-fg-muted">
            <Badge tone="success">earned</Badge>
            <code>{o.tool}</code> runs at Level {o.level} without approval
            <Button size="sm" variant="ghost" onClick={() => revoke.mutate(o.id)} loading={revoke.isPending}>
              <Undo2 /> Revoke
            </Button>
          </div>
        ))}

        <ErrorNote error={toggle.error ?? setClearance.error ?? grant.error ?? revoke.error} />
        <Button variant={agent.status === 'paused' ? 'success' : 'secondary'} size="sm" onClick={() => toggle.mutate()} loading={toggle.isPending}>
          {agent.status === 'paused' ? <><Play /> Resume agent</> : <><Pause /> Pause agent</>}
        </Button>
      </CardBody>
    </Card>
  );
}

export function AgentsPage() {
  const agents = useQuery({ queryKey: ['agents'], queryFn: api.agents.list });
  const suggestions = useQuery({ queryKey: ['agents', 'suggestions'], queryFn: api.agents.suggestions });

  return (
    <div>
      <PageHeader
        title="Agents"
        description="Each agent is a first-class worker with its own identity, tools, budget and clearance. Pause any of them instantly."
      />
      {agents.isLoading && <Spinner />}
      <ErrorNote error={agents.error} />
      {agents.data?.length === 0 && <EmptyState icon={<Bot />} title="No agents yet">Install an industry pack to hire your first agents.</EmptyState>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        {agents.data?.map((a) => (
          <AgentCard key={a.id} agent={a} suggestions={(suggestions.data ?? []).filter((s) => s.agentId === a.id)} />
        ))}
      </div>
    </div>
  );
}
