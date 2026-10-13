import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Phone, PhoneMissed, Plus, Repeat, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { STAGE_KEYS, type Case } from '@onehuman/schemas';
import { AnimatedNumber, ProgressRing, RingPulse } from '@/components/motion';
import { StageDots } from '@/components/stage-dots';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { EmptyState, Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { dotsFromCase, dueWords, homeBuckets, stageNames, statusWords } from '@/lib/cases';
import { useNewRequest } from '@/lib/new-request';
import { useSession } from '@/lib/session';
import { cn, formatInr } from '@/lib/utils';
import { time12 } from '@/routes/routines';

function CaseLine({ c, names, now }: { c: Case; names: string[]; now: Date }) {
  const due = dueWords(c.resolveBy, now);
  return (
    <li>
      <Link to={`/cases/${c.id}`} className="flex flex-col gap-2 px-5 py-3 transition-colors duration-300 hover:bg-line-5 sm:flex-row sm:items-center sm:gap-4">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">{c.title}</span>
          <span className="block truncate text-xs text-fg-muted">
            <span className="tabular-nums">{c.code}</span> · {statusWords(c.status)}
            {due && <span className={due.late ? 'text-danger' : undefined}> · {due.text}</span>}
          </span>
        </span>
        <StageDots states={dotsFromCase(c)} names={names} />
      </Link>
    </li>
  );
}

/** Home: where every request is, what waits on people, and what needs you. */
export function HomePage() {
  const user = useSession((s) => s.user);
  const showNewRequest = useNewRequest((s) => s.show);
  const overview = useQuery({ queryKey: ['ops', 'overview'], queryFn: api.ops.overview, refetchInterval: 60_000 });
  const cases = useQuery({ queryKey: ['cases', 'open'], queryFn: () => api.cases.list('open') });
  const mine = useQuery({ queryKey: ['approvals', 'pending', true], queryFn: () => api.approvals.list('pending', { mine: true }) });
  const goals = useQuery({ queryKey: ['goals'], queryFn: api.goals.list });
  const delegations = useQuery({ queryKey: ['delegations', 'all'], queryFn: () => api.delegations.list() });
  const routines = useQuery({ queryKey: ['routines'], queryFn: api.routines.list });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });

  const lifecycle = workspaces.data?.[0]?.pack.lifecycle;
  const names = stageNames(lifecycle);
  const dotNames = STAGE_KEYS.map((k) => names[k]);
  const plural = (lifecycle?.case.plural ?? 'Cases').toLowerCase();
  const now = new Date();
  const b = homeBuckets(cases.data ?? [], now);
  const pulse = overview.data?.pulse;
  const needsYou = mine.data ?? [];
  const reviews = (goals.data ?? []).filter((g) => g.status === 'awaiting_plan_approval');
  const dayAgo = now.getTime() - 86_400_000;
  const teamStuck = (delegations.data ?? []).filter(
    (d) => ['declined', 'blocked', 'not_done', 'unreachable'].includes(d.status) && d.completedAt && Date.parse(d.completedAt) > dayAgo,
  );
  const withTeam = (delegations.data ?? []).filter((d) => d.stage !== 'closed');
  const activeRoutines = (routines.data ?? []).filter((r) => r.status === 'active');
  const firstName = user?.name.split(' ')[0];

  const tiles = [
    { label: `Open ${plural}`, value: b.open, tone: 'text-fg', to: '/cases' },
    { label: 'Waiting on you', value: needsYou.length, tone: needsYou.length ? 'text-warning' : 'text-fg', to: '/approvals' },
    { label: 'About to miss the deadline', value: b.atRisk.length, tone: b.atRisk.length ? 'text-danger' : 'text-fg', to: '/cases' },
    { label: 'Done today', value: pulse?.completedToday ?? 0, tone: 'text-success', to: '/reports' },
  ];

  return (
    <div className="space-y-8">
      <section className="hero-glow relative -mx-4 overflow-hidden px-4 py-10 md:mx-0 md:rounded-lg md:px-8">
        <div className="dots-floor pointer-events-none absolute inset-x-0 bottom-0 h-32" aria-hidden />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-3xl min-w-0">
            <h1 className="font-display text-4xl leading-[1.05] font-light tracking-tight text-fg md:text-5xl">
              <span className="block text-fg-lead">{firstName ? `Good to see you, ${firstName}.` : 'Good to see you.'}</span>
              <span className="block">{pulse?.headline ?? 'Here is where things stand.'}</span>
            </h1>
            {pulse && pulse.lines.length > 0 && <p className="mt-4 text-base font-light text-fg-body">{pulse.lines.join(' ')}</p>}
          </div>
          <Button size="lg" onClick={() => showNewRequest()}>
            <Plus /> New request
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className="glass rounded-lg px-4 py-4 transition-colors duration-300 hover:bg-line-5">
            <p className="text-sm text-fg-lead">{t.label}</p>
            <p className={cn('mt-1 font-display text-3xl font-light tabular-nums', t.tone)}>
              <AnimatedNumber value={t.value} />
            </p>
          </Link>
        ))}
      </div>

      <section aria-labelledby="by-stage">
        <h2 id="by-stage" className="font-display text-2xl font-light text-fg">
          <span className="text-fg-lead">Open {plural}</span> by stage
        </h2>
        <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STAGE_KEYS.map((k, i) => (
            <li key={k}>
              <Link to={`/cases?stage=${k}`} className="glass flex h-full flex-col rounded-lg p-4 transition-colors duration-300 hover:bg-line-5">
                <span className="grid size-7 place-items-center rounded-sm bg-node text-xs font-semibold text-fg tabular-nums">{i + 1}</span>
                <span className="mt-3 line-clamp-2 min-h-10 text-sm text-fg-body">{names[k]}</span>
                <span className={cn('mt-2 font-display text-3xl font-light tabular-nums', b.byStage[k] ? 'text-fg' : 'text-fg-muted')}>{b.byStage[k]}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Waiting on people" description="Approvals, sign-offs and missing details." action={<Link to="/cases?status=waiting" className="text-sm text-accent hover:underline">All</Link>} />
            {cases.isLoading ? (
              <Spinner />
            ) : b.waiting.length === 0 ? (
              <EmptyState title="Nobody is holding anything up" />
            ) : (
              <ul className="divide-y divide-line-10">
                {b.waiting.slice(0, 8).map((c) => (
                  <CaseLine key={c.id} c={c} names={dotNames} now={now} />
                ))}
              </ul>
            )}
          </Card>

          {b.atRisk.length > 0 && (
            <Card>
              <CardHeader title="About to miss the deadline" description="Due within a day, or already late." />
              <ul className="divide-y divide-line-10">
                {b.atRisk.slice(0, 6).map((c) => (
                  <CaseLine key={c.id} c={c} names={dotNames} now={now} />
                ))}
              </ul>
            </Card>
          )}

          {withTeam.length > 0 && (
            <Card>
              <CardHeader
                title={
                  <span className="inline-flex items-center gap-2">
                    <Phone className="size-4 text-accent" aria-hidden /> With your team
                  </span>
                }
                description="Work handed to people in charge, followed up by phone."
                action={<Link to="/calls" className="text-sm text-accent hover:underline">All calls</Link>}
              />
              <ul className="divide-y divide-line-10">
                {withTeam.slice(0, 6).map((d) => (
                  <li key={d.id}>
                    <Link to={`/goals/${d.goalId}`} className="flex items-center gap-3 px-5 py-3 transition-colors duration-300 hover:bg-line-5">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                        {d.staffName.split(' ').map((p) => p[0]).join('').slice(0, 2)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-fg">{d.title}</span>
                        <span className="block truncate text-xs text-fg-muted">{d.staffName}</span>
                      </span>
                      <span className="flex gap-1" aria-hidden>
                        {(['assign', 'follow_up', 'confirm'] as const).map((st) => {
                          const done = d.calls.some((c) => c.stage === st && c.status === 'completed');
                          return <span key={st} className={cn('size-2 rounded-full', done ? 'bg-success' : d.stage === st ? 'live-dot bg-accent' : 'bg-line-15')} />;
                        })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className={needsYou.length + reviews.length + teamStuck.length > 0 ? 'glass-warm' : undefined}>
            <CardHeader title="Needs you" />
            {needsYou.length + reviews.length + teamStuck.length === 0 ? (
              <CardBody className="text-sm text-fg-lead">Nothing needs you right now.</CardBody>
            ) : (
              <ul className="divide-y divide-line-10">
                {needsYou.slice(0, 6).map((a) => (
                  <li key={a.id}>
                    <Link to={a.kind === 'case_gate' && a.caseId ? `/cases/${a.caseId}` : '/approvals'} className="flex items-center gap-3 px-5 py-3 transition-colors duration-300 hover:bg-line-5">
                      <ShieldCheck className="size-4 shrink-0 text-warning" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">{a.summary}</span>
                      <Chip tone="waiting">{a.kind === 'case_gate' ? (a.stage === 'close' ? 'Sign-off' : 'Approval') : 'Agent step'}</Chip>
                    </Link>
                  </li>
                ))}
                {reviews.map((g) => (
                  <li key={g.id}>
                    <Link to={`/goals/${g.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors duration-300 hover:bg-line-5">
                      <ClipboardCheck className="size-4 shrink-0 text-warning" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">Check the plan: {g.text}</span>
                    </Link>
                  </li>
                ))}
                {teamStuck.map((d) => (
                  <li key={d.id}>
                    <Link to={`/goals/${d.goalId}`} className="flex items-center gap-3 px-5 py-3 transition-colors duration-300 hover:bg-line-5">
                      <PhoneMissed className="size-4 shrink-0 text-danger" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">
                        {d.staffName}: {d.outcome?.summary ?? 'could not finish'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {activeRoutines.length > 0 && (
            <Card>
              <CardHeader
                title={
                  <span className="inline-flex items-center gap-2">
                    <Repeat className="size-4 text-accent" aria-hidden /> Today's check-ins
                  </span>
                }
                action={<Link to="/routines" className="text-sm text-accent hover:underline">All</Link>}
              />
              <ul className="divide-y divide-line-10">
                {activeRoutines.map((r) => (
                  <li key={r.id}>
                    <Link to={`/routines/${r.id}`} className="flex items-center gap-4 px-5 py-3 transition-colors duration-300 hover:bg-line-5">
                      <ProgressRing value={r.today.reported} max={r.today.expected} size={44} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{r.name}</span>
                        <span className="block truncate text-xs text-fg-muted">
                          {r.mode === 'automatic' ? 'AI calls' : 'Filled in by hand'} at {time12(r.time)}
                          {r.today.flags.length > 0 && <span className="text-warning"> · {r.today.flags.length} problem{r.today.flags.length === 1 ? '' : 's'}</span>}
                        </span>
                      </span>
                      {r.today.calling > 0 && (
                        <span className="relative grid size-8 place-items-center rounded-full bg-success-soft text-success" title="Calling now">
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
            <CardHeader title="KPIs" description="From your industry setup." />
            <CardBody className="space-y-3">
              {overview.data?.kpis.map((k) => (
                <div key={k.id} className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-fg">{k.name}</span>
                  {k.value === null ? (
                    <span className="text-xs text-fg-muted" title={k.note}>
                      needs a connection
                    </span>
                  ) : (
                    <span className="font-semibold text-fg tabular-nums">
                      {k.unit === 'inr' ? formatInr(k.value) : k.unit === 'percent' ? `${k.value}%` : k.unit === 'minutes' ? `${k.value} min` : k.value}
                    </span>
                  )}
                </div>
              ))}
              {overview.isLoading && <Spinner className="py-4" />}
              <p className="border-t border-line-10 pt-3 text-sm text-fg-lead">
                AI spend today <span className="float-right font-medium text-fg tabular-nums">{formatInr(pulse?.spendTodayInr ?? 0)}</span>
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
