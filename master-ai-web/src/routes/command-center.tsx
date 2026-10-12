import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, CircleAlert, ClipboardCheck, Inbox, Phone, PhoneMissed, Repeat, Send, Sparkles } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Goal } from '@onehuman/schemas';
import { ProgressRing, RingPulse } from '@/components/motion';
import { StatusBadge } from '@/components/status';
import { time12 } from '@/routes/routines';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorNote, Spinner } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { STAGE_NAME } from '@/components/delegation-card';
import { formatDateTime, formatInr, timeAgo } from '@/lib/utils';

function CommandBar() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [text, setText] = useState(() => params.get('goal') ?? '');
  const [skipReview, setSkipReview] = useState(false);
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });
  const examples = workspaces.data?.[0]?.pack.workflows.slice(0, 4).map((w) => w.name) ?? [];
  const create = useMutation({
    mutationFn: () => api.goals.create({ text, autoStart: skipReview }),
    onSuccess: (goal) => navigate(`/goals/${goal.id}`),
  });

  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 3) create.mutate();
        }}
      >
        <div className="px-5 pt-4">
          <label htmlFor="goal" className="flex items-center gap-2 text-sm font-medium text-fg">
            <Sparkles className="size-4 text-primary" aria-hidden /> What should the company get done?
          </label>
          <Textarea
            id="goal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
            }}
            placeholder="e.g. Follow up on every enquiry that has been waiting more than two days"
            rows={2}
            className="mt-2 resize-none border-0 bg-transparent px-0 text-base focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          {examples.map((ex) => (
            <button key={ex} type="button" onClick={() => setText(ex)} className="rounded-full border border-border px-2.5 py-1 text-xs text-fg-muted hover:border-primary hover:text-primary">
              {ex}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-fg-muted">
            <input type="checkbox" checked={skipReview} onChange={(e) => setSkipReview(e.target.checked)} className="accent-[var(--oh-primary)]" />
            Skip plan review
          </label>
          <Button type="submit" loading={create.isPending} disabled={text.trim().length < 3}>
            <Send /> Run
          </Button>
        </div>
      </form>
      <ErrorNote error={create.error} className="mx-5 mb-4" />
    </Card>
  );
}

function GoalRow({ goal }: { goal: Goal }) {
  return (
    <li>
      <Link to={`/goals/${goal.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/60">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">{goal.text}</p>
          <p className="text-xs text-fg-muted">
            {timeAgo(goal.createdAt)} · {goal.plan ? `${goal.plan.tasks.length} task${goal.plan.tasks.length === 1 ? '' : 's'}` : 'planning'} · {formatInr(goal.costInr)}
          </p>
        </div>
        <StatusBadge status={goal.status} />
      </Link>
    </li>
  );
}

export function CommandCenterPage() {
  const overview = useQuery({ queryKey: ['ops', 'overview'], queryFn: api.ops.overview, refetchInterval: 60_000 });
  const goals = useQuery({ queryKey: ['goals'], queryFn: api.goals.list });
  const approvals = useQuery({ queryKey: ['approvals', 'pending'], queryFn: () => api.approvals.list('pending') });
  const delegations = useQuery({ queryKey: ['delegations', 'all'], queryFn: () => api.delegations.list() });
  const routines = useQuery({ queryKey: ['routines'], queryFn: api.routines.list });
  const activeRoutines = (routines.data ?? []).filter((r) => r.status === 'active');
  const withTeam = (delegations.data ?? []).filter((d) => d.stage !== 'closed');
  const dayAgo = Date.now() - 86_400_000;
  const teamStuck = (delegations.data ?? []).filter(
    (d) => ['declined', 'blocked', 'not_done', 'unreachable'].includes(d.status) && d.completedAt && Date.parse(d.completedAt) > dayAgo,
  );

  const all = goals.data ?? [];
  const reviews = all.filter((g) => g.status === 'awaiting_plan_approval');
  const live = all.filter((g) => g.status === 'running' || g.status === 'planning');
  const recent = all.filter((g) => !['running', 'planning', 'awaiting_plan_approval'].includes(g.status)).slice(0, 8);
  const pulse = overview.data?.pulse;

  return (
    <div className="space-y-6">
      <div className="hero-glow -mx-4 rounded-2xl border border-border px-6 py-7 md:mx-0">
        <p className="text-xs font-medium tracking-wider text-fg-muted uppercase">Command center</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">{pulse?.headline ?? 'Good to see you'}</h1>
        {pulse && <p className="mt-1 max-w-3xl text-sm text-fg-muted">{pulse.lines.join(' ')}</p>}
      </div>

      <CommandBar />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          {(reviews.length > 0 || (approvals.data?.length ?? 0) > 0 || teamStuck.length > 0) && (
            <Card className="border-level-4/40">
              <CardHeader title={<span className="inline-flex items-center gap-2"><CircleAlert className="size-4 text-level-4" /> Needs you</span>} />
              <ul className="divide-y divide-border">
                {reviews.map((g) => (
                  <li key={g.id}>
                    <Link to={`/goals/${g.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/60">
                      <ClipboardCheck className="size-4 text-level-4" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">Review plan: {g.text}</span>
                      <ArrowRight className="size-4 text-fg-muted" aria-hidden />
                    </Link>
                  </li>
                ))}
                {teamStuck.map((d) => (
                  <li key={d.id}>
                    <Link to={`/goals/${d.goalId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/60">
                      <PhoneMissed className="size-4 text-danger" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">
                        {d.staffName}: {d.outcome?.summary ?? d.status} <span className="text-fg-muted">· {d.title}</span>
                      </span>
                      <ArrowRight className="size-4 text-fg-muted" aria-hidden />
                    </Link>
                  </li>
                ))}
                {approvals.data?.slice(0, 5).map((a) => (
                  <li key={a.id}>
                    <Link to="/approvals" className="flex items-center gap-3 px-5 py-3 hover:bg-muted/60">
                      <Inbox className="size-4 text-level-4" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">
                        {a.summary} <span className="text-fg-muted">· {a.agentName}</span>
                      </span>
                      <span className="font-mono text-xs text-fg-muted">risk {a.riskScore}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {withTeam.length > 0 && (
            <Card>
              <CardHeader
                title={<span className="inline-flex items-center gap-2"><Phone className="size-4 text-primary" /> With your team</span>}
                description="Work handed to people in charge, followed up by phone."
                action={<Link to="/calls" className="text-sm text-primary hover:underline">All calls</Link>}
              />
              <ul className="divide-y divide-border">
                {withTeam.slice(0, 6).map((d) => (
                  <li key={d.id}>
                    <Link to={`/goals/${d.goalId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/60">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                        {d.staffName.split(' ').map((p) => p[0]).join('').slice(0, 2)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg">{d.title}</span>
                        <span className="block truncate text-xs text-fg-muted">
                          {d.staffName} · {d.status.replace(/_/g, ' ')}
                          {d.nextCallAt ? ` · next: ${STAGE_NAME[d.stage as 'assign']} call ${formatDateTime(d.nextCallAt)}` : d.dueAt ? ` · due ${formatDateTime(d.dueAt)}` : ''}
                        </span>
                      </span>
                      <span className="flex gap-1" aria-label="Call stages">
                        {(['assign', 'follow_up', 'confirm'] as const).map((st) => {
                          const done = d.calls.some((c) => c.stage === st && c.status === 'completed');
                          return <span key={st} title={STAGE_NAME[st]} className={done ? 'size-2 rounded-full bg-success' : d.stage === st ? 'live-dot size-2 rounded-full bg-info' : 'size-2 rounded-full bg-muted'} />;
                        })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {activeRoutines.length > 0 && (
            <Card>
              <CardHeader
                title={<span className="inline-flex items-center gap-2"><Repeat className="size-4 text-primary" /> Today's check-ins</span>}
                description="Daily reports collected by hand or by the AI's calls."
                action={<Link to="/routines" className="text-sm text-primary hover:underline">All routines</Link>}
              />
              <ul className="divide-y divide-border">
                {activeRoutines.map((r) => (
                  <li key={r.id}>
                    <Link to={`/routines/${r.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-muted/60">
                      <ProgressRing value={r.today.reported} max={r.today.expected} size={44} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{r.name}</span>
                        <span className="block truncate text-xs text-fg-muted">
                          {r.mode === 'automatic' ? 'AI calls' : 'Filled in by hand'} at {time12(r.time)}
                          {r.today.flags.length > 0 && <span className="text-warning"> · {r.today.flags.length} problem{r.today.flags.length === 1 ? '' : 's'}</span>}
                        </span>
                      </span>
                      {r.today.calling > 0 && (
                        <span className="relative grid size-8 place-items-center rounded-full bg-primary text-primary-fg" title="Calling now">
                          <Phone className="size-4" aria-hidden />
                          <RingPulse />
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Live operations" description="Goals your agents are working on right now." />
            {goals.isLoading ? (
              <Spinner />
            ) : live.length === 0 ? (
              <EmptyState title="No agents are working right now">Give the company a goal above and the orchestrator will plan it.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">{live.map((g) => <GoalRow key={g.id} goal={g} />)}</ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Recent goals" />
            {recent.length === 0 ? (
              <EmptyState title="Nothing finished yet" />
            ) : (
              <ul className="divide-y divide-border">{recent.map((g) => <GoalRow key={g.id} goal={g} />)}</ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Today" />
            <CardBody className="grid grid-cols-2 gap-4">
              {[
                ['Approvals waiting', pulse?.pendingApprovals],
                ['Tasks running', pulse?.runningTasks],
                ['Done today', pulse?.completedToday],
                ['Blocked today', pulse?.blockedToday],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <p className="text-2xl font-semibold tabular-nums text-fg">{value ?? '–'}</p>
                  <p className="text-xs text-fg-muted">{label}</p>
                </div>
              ))}
              <div className="col-span-2 border-t border-border pt-3 text-sm text-fg-muted">
                AI spend today <span className="float-right font-medium text-fg">{formatInr(pulse?.spendTodayInr ?? 0)}</span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="KPIs" description="From your industry pack." />
            <CardBody className="space-y-3">
              {overview.data?.kpis.map((k) => (
                <div key={k.id} className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-fg">{k.name}</span>
                  {k.value === null ? (
                    <span className="text-xs text-fg-muted" title={k.note}>needs connector</span>
                  ) : (
                    <span className="font-semibold tabular-nums text-fg">
                      {k.unit === 'inr' ? formatInr(k.value) : k.unit === 'percent' ? `${k.value}%` : k.unit === 'minutes' ? `${k.value} min` : k.value}
                    </span>
                  )}
                </div>
              ))}
              {overview.isLoading && <Spinner className="py-4" />}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
