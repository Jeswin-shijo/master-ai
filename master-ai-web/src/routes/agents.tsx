import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Bot, Pause, Play, Undo2 } from 'lucide-react';
import type { AgentView, AutonomySuggestion, ResolvedPack } from '@onehuman/schemas';
import { toolLabel } from '@onehuman/sdk';
import { AgentJobs } from '@/components/agents/agent-jobs';
import { JobCard } from '@/components/agents/job-card';
import { StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatInr } from '@/lib/utils';

/** What an assistant may do on its own. Level 4 steps always ask the owner, so 4 reads like 3. */
const CLEARANCE_OPTIONS: Record<1 | 2 | 3 | 4, string> = {
  1: 'Only look things up',
  2: 'Look things up and prepare drafts',
  3: 'Handle everyday tasks',
  4: 'Handle everyday tasks',
};

function AgentCard({ agent, suggestions, pack, manager }: { agent: AgentView; suggestions: AutonomySuggestion[]; pack?: ResolvedPack; manager: boolean }) {
  const label = (tool: string) => toolLabel(tool, pack);
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['agents'] });
  const toggle = useMutation({ mutationFn: () => (agent.status === 'paused' ? api.agents.resume(agent.id) : api.agents.pause(agent.id)), onSuccess: refresh });
  const setClearance = useMutation({ mutationFn: (autonomy: 1 | 2 | 3 | 4) => api.agents.update(agent.id, { autonomy }), onSuccess: refresh });
  const grant = useMutation({ mutationFn: (tool: string) => api.agents.addOverride(agent.id, { tool, level: 3 }), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: (overrideId: string) => api.agents.removeOverride(agent.id, overrideId), onSuccess: refresh });
  const budgets = agent.spec.budgets;

  return (
    <Card role="article" aria-label={agent.name}>
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
          <label className="text-sm text-fg-muted" htmlFor={`clearance-${agent.id}`}>On its own it may</label>
          <Select
            id={`clearance-${agent.id}`}
            className="w-auto"
            value={agent.autonomy}
            onChange={(e) => setClearance.mutate(Number(e.target.value) as 1 | 2 | 3 | 4)}
          >
            {([1, 2, 3, 4] as const)
              .filter((l) => l < 4 || agent.autonomy === 4)
              .map((l) => (
                <option key={l} value={l}>{CLEARANCE_OPTIONS[l]}</option>
              ))}
          </Select>
          <span className="text-xs text-fg-muted">
            Anything more waits for your OK ·{' '}
            {budgets.money_per_task_inr > 0 ? `spending limit ${formatInr(budgets.money_per_task_inr)} per job` : 'cannot spend money'}
          </span>
        </div>

        {agent.job ? (
          <JobCard agent={agent} pack={pack} canEdit={manager} />
        ) : (
          <div>
            <p className="mb-1 text-xs text-fg-muted">Can:</p>
            <ul className="flex flex-wrap gap-1">
              {agent.tools.map((t) => {
                const override = agent.overrides.find((o) => o.tool === t);
                return (
                  <li
                    key={t}
                    className={override ? 'rounded-md bg-success-soft px-2 py-0.5 text-xs text-success' : 'rounded-md bg-muted px-2 py-0.5 text-xs text-fg'}
                    title={override ? 'You trusted it to do this without asking' : undefined}
                  >
                    {label(t)}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {suggestions.map((s) => (
          <div key={s.tool} className="flex flex-wrap items-center gap-3 rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm">
            <Award className="size-4 text-success" aria-hidden />
            <span className="flex-1 text-fg">
              You approved “{label(s.tool)}” {s.consecutiveCleanApprovals} times in a row without changes. Let {agent.name} do it without asking? Money limits still apply.
            </span>
            <Button size="sm" variant="success" onClick={() => grant.mutate(s.tool)} loading={grant.isPending}>Yes, trust it</Button>
          </div>
        ))}

        {agent.overrides.map((o) => (
          <div key={o.id} className="flex items-center gap-3 text-sm text-fg-muted">
            <Badge tone="success">trusted</Badge>
            “{label(o.tool)}” no longer asks you first
            <Button size="sm" variant="ghost" onClick={() => revoke.mutate(o.id)} loading={revoke.isPending}>
              <Undo2 /> Ask me again
            </Button>
          </div>
        ))}

        <AgentJobs jobs={agent.jobs} canManage={manager} />

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
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });
  const role = useSession((s) => s.user?.role);
  const manager = role === 'owner' || role === 'admin';

  return (
    <div>
      <PageHeader
        lead="Your AI"
        title="team."
        description="Your AI team. Each assistant has its own job, what it may do on its own, and a spending limit. Pause any of them instantly."
      />
      {agents.isLoading && <Spinner />}
      <ErrorNote error={agents.error} />
      {agents.data?.length === 0 && <EmptyState icon={<Bot />} title="No agents yet">Install an industry pack to hire your first agents.</EmptyState>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        {agents.data?.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            pack={workspaces.data?.find((w) => w.id === a.workspaceId)?.pack ?? workspaces.data?.[0]?.pack}
            manager={manager}
            suggestions={(suggestions.data ?? []).filter((s) => s.agentId === a.id)}
          />
        ))}
      </div>
    </div>
  );
}
