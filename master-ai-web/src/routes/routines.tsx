import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarClock, Flag, Pause, PencilLine, Phone, PhoneOff, Play, Repeat, Sparkles, Users, X } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import type { CheckinEntry, CheckinStatus, CheckinValue, Routine, RoutineQuestion } from '@onehuman/schemas';
import { CheckinForm } from '@/components/checkin-form';
import { PackUpdatesBanner } from '@/components/pack-updates';
import { AnimatedNumber, DrawCheck, item, LiftCard, ModeSwitch, ProgressRing, RingPulse, spring, Stagger } from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorNote, Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { useNewRequest } from '@/lib/new-request';
import { cn, timeAgo } from '@/lib/utils';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function time12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

export function daysText(days: number[]): string {
  const d = [...days].sort();
  if (d.length === 7) return 'every day';
  if (d.join() === '1,2,3,4,5,6') return 'Mon–Sat';
  if (d.join() === '1,2,3,4,5') return 'Mon–Fri';
  return d.map((x) => DAY_NAMES[x]).join(', ');
}

function whenText(iso: string | null): string {
  if (!iso) return 'Paused';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const tomorrow = new Date(Date.now() + 86_400_000).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return today ? `Today ${time}` : tomorrow ? `Tomorrow ${time}` : `${d.toLocaleDateString('en-IN', { weekday: 'short' })} ${time}`;
}

function initials(name: string) {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

const STATUS_DOT: Record<CheckinStatus, string> = {
  pending: 'bg-fg-muted/40',
  calling: 'bg-primary',
  reported: 'bg-success',
  missed: 'bg-danger',
};

function useUpdateRoutine(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof api.routines.update>[1]) => api.routines.update(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['routines'] });
      void queryClient.invalidateQueries({ queryKey: ['routine', id] });
    },
  });
}

/** "The AI phones 3 people at 6:00 pm, Mon–Sat." */
function ModeSentence({ routine }: { routine: Routine }) {
  const n = routine.people.length;
  const who = `${n} ${n === 1 ? 'person' : 'people'}`;
  return routine.mode === 'automatic' ? (
    <p className="text-sm text-fg-muted">
      <Phone className="mr-1 inline size-3.5 text-primary" aria-hidden />
      The AI phones {who} at <span className="font-medium text-fg">{time12(routine.time)}</span>, {daysText(routine.days)}, and fills it in from what they say.
    </p>
  ) : (
    <p className="text-sm text-fg-muted">
      <PencilLine className="mr-1 inline size-3.5 text-accent" aria-hidden />
      {who} fill it in here by <span className="font-medium text-fg">{time12(routine.time)}</span>, {daysText(routine.days)}.
      {routine.chaseMissing ? ' Anyone who hasn’t gets a call from the AI.' : ' Nobody is called.'}
    </p>
  );
}

function RoutineCard({ routine }: { routine: Routine }) {
  const queryClient = useQueryClient();
  const update = useUpdateRoutine(routine.id);
  const run = useMutation({ mutationFn: () => api.routines.run(routine.id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routines'] }) });
  const t = routine.today;
  const paused = routine.status === 'paused';
  return (
    <LiftCard className={cn('flex flex-col overflow-hidden', paused && 'opacity-70')}>
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to={`/routines/${routine.id}`} className="text-base font-semibold text-fg hover:underline">
              {routine.name}
            </Link>
            <p className="mt-0.5 line-clamp-2 text-sm text-fg-muted">{routine.description}</p>
          </div>
          {paused ? <Badge>Paused</Badge> : t.flags.length > 0 && <Badge tone="warning">{t.flags.length} problem{t.flags.length === 1 ? '' : 's'}</Badge>}
        </div>
        <ModeSwitch id={routine.id} mode={routine.mode} onChange={(mode) => update.mutate({ mode })} disabled={update.isPending} />
        <ModeSentence routine={routine} />
        <div className="flex items-center gap-4 rounded-xl bg-muted/50 p-3">
          <ProgressRing value={t.reported} max={t.expected} label={`${t.reported} of ${t.expected} reported today`} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-fg-muted">Today</p>
            <div className="mt-1 flex -space-x-2">
              {routine.people.slice(0, 6).map((p) => {
                const s = routine.todayStatus[p.id] ?? 'pending';
                return (
                  <span key={p.id} title={`${p.name}: ${s}`} className="relative grid size-8 place-items-center rounded-full border-2 border-surface bg-accent-soft text-[11px] font-semibold text-accent">
                    {initials(p.name)}
                    {s === 'calling' && <RingPulse />}
                    <span className={cn('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-surface', STATUS_DOT[s])} />
                  </span>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              <CalendarClock className="mr-1 inline size-3" aria-hidden />
              Next: {whenText(routine.nextRunAt)}
            </p>
          </div>
        </div>
        <ErrorNote error={update.error ?? run.error} />
      </div>
      <div className="mt-auto flex items-center gap-2 border-t border-border px-5 py-3">
        <Button size="sm" onClick={() => run.mutate()} loading={run.isPending} disabled={paused}>
          <Phone /> {routine.mode === 'automatic' ? 'Call now' : 'Chase now'}
        </Button>
        <Link to={`/routines/${routine.id}`} className="ml-auto inline-flex items-center gap-1 text-sm text-primary hover:underline">
          Open board <ArrowRight className="size-4" />
        </Link>
      </div>
    </LiftCard>
  );
}

/** Every repeating job, how it runs, and how today is going. */
export function RoutinesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const routines = useQuery({ queryKey: ['routines'], queryFn: api.routines.list, refetchInterval: (q) => (q.state.data?.some((r) => r.today.calling > 0) ? 2500 : false) });
  const templates = useQuery({ queryKey: ['routines', 'templates'], queryFn: api.routines.templates });
  const team = useQuery({ queryKey: ['team'], queryFn: api.team.list });
  const create = useMutation({
    mutationFn: (templateId: string) => api.routines.create({ templateId }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['routines'] });
      navigate(`/routines/${r.id}`);
    },
  });
  const unused = (templates.data ?? []).filter((t) => !t.inUse);
  const noTeam = team.data?.filter((p) => p.status === 'active').length === 0;

  return (
    <div className="space-y-8">
      <motion.section
        className="hero-glow relative overflow-hidden rounded-2xl border border-border px-6 py-7"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
      >
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium tracking-wide text-primary uppercase">
          <Repeat className="size-4" aria-hidden /> Routines
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">Jobs that repeat, done by hand or by phone</h1>
        <p className="mt-2 max-w-2xl text-sm text-fg-muted">
          Daily reports, stock counts, status updates. Switch each one between <span className="font-medium text-accent">Manual</span> (people fill it in here) and{' '}
          <span className="font-medium text-primary">Automatic</span> (the AI phones the person in charge, asks the questions and fills it in for them).
        </p>
      </motion.section>

      <PackUpdatesBanner />

      {noTeam && (
        <div className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg">
          <Users className="size-4 text-warning" aria-hidden /> Add the people in charge to your team first, so there is someone to call.
          <Link to="/team" className="ml-auto text-primary hover:underline">Team</Link>
        </div>
      )}

      {routines.isLoading && <Spinner />}
      <ErrorNote error={routines.error ?? create.error} />
      {routines.data && routines.data.length > 0 && (
        <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
          {routines.data.map((r) => (
            <RoutineCard key={r.id} routine={r} />
          ))}
        </Stagger>
      )}

      {unused.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Sparkles className="size-4 text-primary" aria-hidden /> {routines.data?.length ? 'More check-ins for your business' : 'Switch on your first check-in'}
          </h2>
          <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0" delay={0.1}>
            {unused.map((t) => (
              <LiftCard key={t.id} className="flex flex-col p-5">
                <p className="font-semibold text-fg">{t.name}</p>
                <p className="mt-1 text-sm text-fg-muted">{t.description}</p>
                <ul className="mt-3 flex flex-wrap gap-1">
                  {t.questions.map((q) => (
                    <li key={q.key} className={cn('rounded-md px-2 py-0.5 text-xs', q.flag ? 'bg-warning-soft text-warning' : 'bg-muted text-fg')}>
                      {q.label}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-fg-muted">
                  {t.mode === 'automatic' ? 'AI calls' : 'Filled in by hand'} · {daysText(t.days)} at {time12(t.time)}
                </p>
                <Button className="mt-4 self-start" size="sm" onClick={() => create.mutate(t.id)} loading={create.isPending && create.variables === t.id} disabled={noTeam}>
                  <Play /> Switch it on
                </Button>
              </LiftCard>
            ))}
          </Stagger>
        </section>
      )}
      {routines.data?.length === 0 && unused.length === 0 && !templates.isLoading && (
        <EmptyState icon={<Repeat />} title="No check-ins in your setup yet">Update your industry pack from the Industry pack page to get ready-made check-ins.</EmptyState>
      )}
    </div>
  );
}

// ---------- the board: one routine, live ----------

function formatValue(q: RoutineQuestion, v: CheckinValue | undefined): string {
  if (v === undefined || v === null || v === '') return '—';
  if (v === 'none') return 'None';
  if (q.type === 'number') return `${v}${q.unit ? ` ${q.unit}` : ''}`;
  if (q.type === 'percent') return `${v}%`;
  if (q.type === 'yes_no') return v ? 'Yes' : 'No';
  return String(v);
}

function PersonCard({ entry, routine, onFill }: { entry: CheckinEntry; routine: Routine; onFill: () => void }) {
  const [showCall, setShowCall] = useState(false);
  const call = entry.calls[entry.calls.length - 1];
  const live = call && (call.status === 'ringing' || call.status === 'in_progress');
  const lastLine = call?.transcript[call.transcript.length - 1];
  const s = entry.status;
  return (
    <motion.article
      layout
      variants={item}
      transition={spring}
      className={cn(
        'relative overflow-hidden rounded-xl border bg-surface p-4',
        s === 'reported' ? 'border-success/30' : s === 'calling' ? 'border-primary/50 shadow-lg shadow-primary/10' : s === 'missed' ? 'border-danger/30' : 'border-border',
      )}
    >
      {s === 'calling' && <motion.div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent" animate={{ x: ['-100%', '100%'] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }} />}
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'relative grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold',
            s === 'reported' ? 'bg-success-soft text-success' : s === 'calling' ? 'bg-primary text-primary-fg' : s === 'missed' ? 'bg-danger-soft text-danger' : 'bg-muted text-fg-muted',
          )}
        >
          {s === 'reported' ? <DrawCheck className="size-5" /> : s === 'calling' ? <Phone className="size-5" aria-hidden /> : s === 'missed' ? <PhoneOff className="size-5" aria-hidden /> : initials(entry.staffName)}
          {s === 'calling' && <RingPulse />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-fg">{entry.staffName}</p>
          <p className="truncate text-xs text-fg-muted">{entry.staffTitle}</p>
          <p className={cn('mt-1 text-xs font-medium', s === 'reported' ? 'text-success' : s === 'calling' ? 'text-primary' : s === 'missed' ? 'text-danger' : 'text-fg-muted')}>
            {s === 'reported' && `Reported ${entry.source === 'call' ? 'by phone' : 'by hand'} · ${timeAgo(entry.updatedAt)}`}
            {s === 'calling' && (live ? (call.status === 'ringing' ? 'Ringing…' : 'On the phone with the AI…') : 'Calling soon…')}
            {s === 'missed' && 'No update today'}
            {s === 'pending' && 'Not reported yet'}
          </p>
        </div>
      </div>

      <AnimatePresence mode="popLayout">
        {s === 'calling' && live && lastLine && (
          <motion.p
            key={call.transcript.length}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn('mt-3 rounded-lg px-3 py-2 text-sm', lastLine.speaker === 'ai' ? 'bg-muted text-fg' : 'bg-primary-soft text-fg')}
          >
            <span className="mr-1 text-xs text-fg-muted">{lastLine.speaker === 'ai' ? 'AI:' : `${entry.staffName.split(' ')[0]}:`}</span>
            {lastLine.text}
          </motion.p>
        )}
      </AnimatePresence>

      {Object.keys(entry.values).length > 0 && (
        <dl className="mt-3 grid gap-1.5 text-sm">
          {routine.questions.map((q) => {
            const v = entry.values[q.key];
            if (v === undefined) return null;
            const flagged = q.flag && v !== 'none' && v !== false && v !== null && v !== '';
            return (
              <motion.div key={q.key} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className={cn('flex gap-2 rounded-md px-2 py-1', flagged && 'bg-warning-soft')}>
                <dt className="w-32 shrink-0 text-fg-muted">{q.label}</dt>
                <dd className={cn('min-w-0 flex-1', flagged ? 'font-medium text-warning' : 'text-fg')}>
                  {q.type === 'percent' && typeof v === 'number' ? (
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <motion.span className="block h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${v}%` }} transition={{ duration: 0.8 }} />
                      </span>
                      {v}%
                    </span>
                  ) : (
                    formatValue(q, v)
                  )}
                </dd>
              </motion.div>
            );
          })}
        </dl>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onFill}>
          <PencilLine /> {s === 'reported' ? 'Edit' : 'Fill in'}
        </Button>
        {call && call.transcript.length > 0 && (
          <button className="text-xs text-fg-muted hover:text-fg" onClick={() => setShowCall((v) => !v)} aria-expanded={showCall}>
            {showCall ? 'Hide call' : `Show call${entry.calls.length > 1 ? ` (${entry.calls.length} attempts)` : ''}`}
          </button>
        )}
      </div>
      <AnimatePresence>
        {showCall && call && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-3 space-y-1.5 overflow-hidden">
            {call.transcript.map((l, i) => (
              <li key={i} className={cn('flex', l.speaker === 'person' ? 'justify-end' : 'justify-start')}>
                <span className={cn('max-w-[85%] rounded-2xl px-3 py-1.5 text-xs', l.speaker === 'person' ? 'rounded-br-sm bg-primary text-primary-fg' : 'rounded-bl-sm bg-muted text-fg')}>{l.text}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function ScheduleEditor({ routine }: { routine: Routine }) {
  const update = useUpdateRoutine(routine.id);
  const team = useQuery({ queryKey: ['team'], queryFn: api.team.list });
  const [time, setTime] = useState(routine.time);
  const toggleDay = (d: number) => {
    const days = routine.days.includes(d) ? routine.days.filter((x) => x !== d) : [...routine.days, d].sort();
    if (days.length) update.mutate({ days });
  };
  const ids = routine.people.map((p) => p.id);
  const togglePerson = (id: string) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    if (next.length) update.mutate({ staffIds: next });
  };
  return (
    <div className="grid gap-4 rounded-xl border border-border bg-surface p-4 md:grid-cols-[auto_auto_1fr]">
      <label className="space-y-1.5">
        <span className="block text-xs text-fg-muted">{routine.mode === 'automatic' ? 'Calls at' : 'Due by'}</span>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => time !== routine.time && update.mutate({ time })}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm text-fg focus:border-primary focus:outline-none"
        />
      </label>
      <div className="space-y-1.5">
        <span className="block text-xs text-fg-muted">On</span>
        <div className="flex gap-1">
          {DAY_LETTERS.map((l, d) => (
            <motion.button
              key={d}
              whileTap={{ scale: 0.9 }}
              onClick={() => toggleDay(d)}
              aria-pressed={routine.days.includes(d)}
              aria-label={DAY_NAMES[d]}
              className={cn('grid size-9 place-items-center rounded-full text-sm font-medium transition-colors', routine.days.includes(d) ? 'bg-primary text-primary-fg' : 'bg-muted text-fg-muted hover:text-fg')}
            >
              {l}
            </motion.button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <span className="block text-xs text-fg-muted">Who reports</span>
        <div className="flex flex-wrap gap-1.5">
          {(team.data ?? [])
            .filter((p) => p.status === 'active')
            .map((p) => (
              <motion.button
                key={p.id}
                whileTap={{ scale: 0.95 }}
                onClick={() => togglePerson(p.id)}
                aria-pressed={ids.includes(p.id)}
                className={cn('rounded-full border px-3 py-1 text-sm transition-colors', ids.includes(p.id) ? 'border-primary bg-primary-soft text-fg' : 'border-border text-fg-muted hover:text-fg')}
              >
                {p.name}
              </motion.button>
            ))}
        </div>
      </div>
      {routine.mode === 'manual' && (
        <label className="flex items-center gap-2 text-sm text-fg md:col-span-3">
          <input type="checkbox" checked={routine.chaseMissing} onChange={(e) => update.mutate({ chaseMissing: e.target.checked })} className="size-4 accent-[var(--oh-primary)]" />
          If someone hasn’t filled it in by {time12(routine.time)}, the AI phones them
        </label>
      )}
      <ErrorNote error={update.error} />
    </div>
  );
}

/** One routine, live: who has reported, who the AI is calling right now, and what they said. */
export function RoutineBoardPage() {
  const { id = '' } = useParams();
  const showNewRequest = useNewRequest((s) => s.show);
  const queryClient = useQueryClient();
  const [date, setDate] = useState<string | undefined>(undefined);
  const [form, setForm] = useState<{ staffId: string | null; values?: Record<string, CheckinValue> } | null>(null);
  const day = useQuery({
    queryKey: ['routine', id, date ?? 'today'],
    queryFn: () => api.routines.day(id, date),
    refetchInterval: (q) => (q.state.data?.entries.some((e) => e.status === 'calling') ? 1500 : false),
  });
  const update = useUpdateRoutine(id);
  const run = useMutation({ mutationFn: () => api.routines.run(id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['routine', id] }) });

  if (day.isLoading) return <Spinner />;
  if (day.error || !day.data) return <ErrorNote error={day.error ?? new Error('Routine not found')} />;
  const { routine, entries, summary, history } = day.data;
  const isToday = !date;
  const paused = routine.status === 'paused';

  return (
    <div className="space-y-6">
      <Link to="/routines" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Routines
      </Link>

      <motion.header initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="hero-glow rounded-2xl border border-border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">{routine.name}</h1>
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">{routine.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => update.mutate({ status: paused ? 'active' : 'paused' })} loading={update.isPending && !!update.variables?.status}>
              {paused ? <><Play /> Resume</> : <><Pause /> Pause</>}
            </Button>
            <Button size="sm" onClick={() => run.mutate()} loading={run.isPending} disabled={paused}>
              <Phone /> {routine.mode === 'automatic' ? 'Call everyone now' : 'Chase missing now'}
            </Button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <ModeSwitch id={`board-${routine.id}`} mode={routine.mode} onChange={(mode) => update.mutate({ mode })} disabled={update.isPending} />
          <ModeSentence routine={routine} />
        </div>
        <ErrorNote error={update.error ?? run.error} className="mt-3" />
      </motion.header>

      <ScheduleEditor key={routine.updatedAt} routine={routine} />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Day">
        {[{ date: undefined as string | undefined, label: 'Today', s: isToday ? summary : null }, ...history.map((h) => ({ date: h.date, label: new Date(`${h.date}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }), s: h }))].map((d) => (
          <button
            key={d.label}
            role="tab"
            aria-selected={date === d.date}
            onClick={() => setDate(d.date)}
            className={cn('relative rounded-full border px-3 py-1 text-sm transition-colors', date === d.date ? 'border-primary text-fg' : 'border-border text-fg-muted hover:text-fg')}
          >
            {date === d.date && <motion.span layoutId="day-tab" className="absolute inset-0 -z-10 rounded-full bg-primary-soft" transition={spring} />}
            {d.label}
            {d.s && <span className="ml-1.5 text-xs text-fg-muted">{d.s.reported}/{d.s.expected}</span>}
          </button>
        ))}
      </div>

      <Stagger className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <motion.div variants={item} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
          <ProgressRing value={summary.reported} max={summary.expected} size={56} />
          <div>
            <p className="text-xs text-fg-muted">Reported</p>
            <p className="text-sm text-fg">{summary.missed ? `${summary.missed} missed` : summary.reported === summary.expected ? 'Everyone' : `${summary.expected - summary.reported} to go`}</p>
          </div>
        </motion.div>
        <motion.div variants={item} className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-fg-muted">AI calling now</p>
          <p className={cn('mt-1 text-2xl font-semibold', summary.calling ? 'text-primary' : 'text-fg')}>
            <AnimatedNumber value={summary.calling} />
          </p>
        </motion.div>
        {summary.totals.map((t) => (
          <motion.div key={t.key} variants={item} className="rounded-xl border border-border bg-surface p-4">
            <p className="text-xs text-fg-muted">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold text-fg">
              <AnimatedNumber value={t.value} suffix={t.unit === '%' ? '%' : ''} />
              {t.unit && t.unit !== '%' && <span className="ml-1 text-sm font-normal text-fg-muted">{t.unit}</span>}
            </p>
          </motion.div>
        ))}
      </Stagger>

      <AnimatePresence>
        {summary.flags.length > 0 && (
          <motion.section initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden rounded-xl border border-warning/30 bg-warning-soft">
            <h2 className="flex items-center gap-2 px-4 pt-3 text-sm font-semibold text-warning">
              <AlertTriangle className="size-4" aria-hidden /> Needs your attention
            </h2>
            <ul className="divide-y divide-warning/15 px-4 pb-2">
              {summary.flags.map((f) => (
                <li key={f} className="flex flex-wrap items-center gap-3 py-2 text-sm text-fg">
                  <span className="min-w-0 flex-1">{f}</span>
                  <Button size="sm" variant="warning" onClick={() => showNewRequest({ text: `Sort this out: ${f}` })}>
                    <Flag /> Raise a request
                  </Button>
                </li>
              ))}
            </ul>
          </motion.section>
        )}
      </AnimatePresence>

      {entries.length === 0 ? (
        <EmptyState icon={<Users />} title="Nobody reports to this routine yet">Pick who reports above.</EmptyState>
      ) : (
        <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
          {entries.map((e) => (
            <PersonCard key={e.staffId} entry={e} routine={routine} onFill={() => setForm({ staffId: e.staffId, values: e.values })} />
          ))}
        </Stagger>
      )}
      {!isToday && (
        <p className="flex items-center gap-2 text-xs text-fg-muted">
          <X className="size-3" aria-hidden /> Earlier days are read-only; filling in changes today's report.
        </p>
      )}

      <CheckinForm routine={routine} staffId={form?.staffId ?? null} initial={form?.values} open={!!form} onClose={() => setForm(null)} />
    </div>
  );
}
