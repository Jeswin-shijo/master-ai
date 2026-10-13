import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, Send, X } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { STAGE_KEYS, type ApprovalRequest, type Case, type CaseSource, type StageKey } from '@onehuman/schemas';
import { caseFileLines } from '@onehuman/sdk';
import { CaseCanvas, type CasePerson } from '@/components/case-canvas';
import { CaseTimeline } from '@/components/case-file';
import { CaseReportCard } from '@/components/case-report';
import { GoalReportCard } from '@/components/goal-report';
import { StageDots } from '@/components/stage-dots';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNote, Spinner } from '@/components/ui/feedback';
import { Field, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { dotsFromStages, dueWords, FINAL_STATUSES, priorityTone, stageNames, statusWords } from '@/lib/cases';
import { signDecision } from '@/lib/device-key';
import { useSession } from '@/lib/session';
import { formatInr } from '@/lib/utils';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const FROM: Record<CaseSource, string> = { owner: 'Raised by the owner', staff: 'Raised by the team', customer: 'From a customer', system: 'From a system', partner: 'From a partner' };

function personFor(c: Case, gate: ApprovalRequest | undefined, roleName: (id: string) => string): CasePerson | null {
  if (gate?.stage) return { stage: gate.stage, name: cap(roleName(gate.approver)), doing: gate.stage === 'close' ? 'Signs off' : 'Approves', waiting: true };
  if (c.status === 'needs_info') return { stage: 'review', name: c.requester.name, doing: 'Adds the missing details', waiting: true };
  if (c.stage === 'execute' && c.assignee && !FINAL_STATUSES.includes(c.status)) return { stage: 'execute', name: c.assignee.name, doing: 'Doing the work', waiting: false };
  return null;
}

/** Approve or sign off right here when it's yours to decide; otherwise say who decides. */
function GateBanner({ gate, canDecide, who, caseId }: { gate: ApprovalRequest; canDecide: boolean; who: string; caseId: string }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const signoff = gate.stage === 'close';
  const decide = useMutation({
    mutationFn: async (decision: 'approved' | 'rejected') => {
      const signed = await signDecision({ approvalId: gate.id, decision, notes: notes || undefined });
      return api.approvals.decide(gate.id, { decision, notes: notes || undefined, ...signed });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
  return (
    <section className="glass-warm rounded-lg p-5" aria-label={signoff ? 'Sign-off' : 'Approval'}>
      <p className="text-sm font-medium text-warning">{signoff ? 'Waiting for sign-off' : 'Waiting for approval'}</p>
      <h2 className="mt-1 text-lg text-fg [overflow-wrap:anywhere]">{gate.summary}</h2>
      {gate.reasons.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-fg-body">
          {gate.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {gate.evidence.length > 0 && (
        <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
          {gate.evidence.map((e, i) => (
            <div key={i} className="contents">
              <dt className="text-fg-muted">{e.label}</dt>
              <dd className="whitespace-pre-line text-fg [overflow-wrap:anywhere]">{e.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {canDecide ? (
        <div className="mt-4 space-y-3">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="A note for the record (optional)" aria-label="Note for the record" />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => decide.mutate('approved')} loading={decide.isPending && decide.variables === 'approved'}>
              <Check /> {signoff ? 'Sign off' : 'Approve'}
            </Button>
            <Button variant="danger" onClick={() => decide.mutate('rejected')} loading={decide.isPending && decide.variables === 'rejected'}>
              <X /> {signoff ? 'Refuse sign-off' : 'Reject'}
            </Button>
          </div>
          <ErrorNote error={decide.error} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-fg-lead">{cap(who)} decides this. They have been told.</p>
      )}
    </section>
  );
}

function AddDetails({ caseId, missing }: { caseId: string; missing: { label: string }[] }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const add = useMutation({
    mutationFn: () => api.cases.addInfo(caseId, { text }),
    onSuccess: () => {
      setText('');
      void queryClient.invalidateQueries({ queryKey: ['case', caseId] });
    },
  });
  return (
    <section className="glass-warm rounded-lg p-5" aria-label="Missing details">
      <p className="text-sm font-medium text-warning">Needs details</p>
      <h2 className="mt-1 text-lg text-fg">{missing.length > 0 ? `Missing: ${missing.map((m) => m.label).join(', ')}.` : 'Review asked for more details.'}</h2>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate();
        }}
      >
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="The missing details" placeholder="Add what's missing. Review runs again." />
        <Button type="submit" loading={add.isPending} disabled={!text.trim()}>
          <Send /> Send details
        </Button>
        <ErrorNote error={add.error} />
      </form>
    </section>
  );
}

function CancelCase({ caseId, noun }: { caseId: string; noun: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = useMutation({
    mutationFn: () => api.cases.cancel(caseId, reason.trim() ? { reason: reason.trim() } : {}),
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['case', caseId] });
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
    },
  });
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <X /> Cancel
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} lead="Cancel" title={`this ${noun}?`}>
        <p className="text-sm text-fg-lead">Work on it stops at its next step. The record stays.</p>
        <div className="mt-4">
          <Field label="Why (optional)" htmlFor="cancel-reason">
            <Textarea id="cancel-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <ErrorNote error={cancel.error} className="mt-3" />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>
            Cancel {noun}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/** One case: where it is in the 8 stages, who it waits on, and what each stage found. */
export function CasePage() {
  const { id = '' } = useParams();
  const role = useSession((s) => s.user?.role);
  const manager = role === 'owner' || role === 'admin';
  const [selected, setSelected] = useState<StageKey | null>(null);
  const detail = useQuery({
    queryKey: ['case', id],
    queryFn: () => api.cases.get(id),
    // Live updates arrive over the realtime stream; a slow poll covers a dropped connection.
    refetchInterval: (q) => (q.state.data && !FINAL_STATUSES.includes(q.state.data.case.status) ? 5000 : false),
  });
  const mine = useQuery({ queryKey: ['approvals', 'pending', true], queryFn: () => api.approvals.list('pending', { mine: true }) });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });

  useEffect(() => {
    if (selected) document.getElementById(`stage-${selected}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selected]);

  if (detail.isLoading) return <Spinner />;
  if (detail.error || !detail.data) return <ErrorNote error={detail.error ?? new Error('This case was not found')} />;

  const { case: c, label, file, approvals, report } = detail.data;
  const lifecycle = (workspaces.data?.find((w) => w.id === c.workspaceId) ?? workspaces.data?.[0])?.pack.lifecycle;
  const names = stageNames(lifecycle);
  const roleName = (rid: string) => (rid === 'owner' ? 'the owner' : (lifecycle?.roles.find((r) => r.id === rid)?.name ?? 'the right person'));
  const rows = STAGE_KEYS.map((k) => report.stages.find((s) => s.stage === k) ?? { stage: k, name: names[k], status: 'pending' as const, minutes: null, summary: null });
  const states = dotsFromStages(rows, { approveDecision: file.approve?.decision });
  const stageLabels = rows.map((r) => r.name || names[r.stage]);
  const lines = caseFileLines(file, { roleName, priorityName: (p) => lifecycle?.priorities.find((x) => x.id === p)?.name });
  const ended = FINAL_STATUSES.includes(c.status);
  const gate = approvals.find((a) => a.kind === 'case_gate' && a.status === 'pending');
  const canDecide = !!gate && (mine.data ?? []).some((a) => a.id === gate.id);
  const person = personFor(c, gate, roleName);
  const due = ended ? null : dueWords(c.resolveBy, new Date());
  const noun = label.label.toLowerCase();

  return (
    <div className="space-y-6">
      <Link to="/cases" className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> {label.plural}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-fg-muted">
            <span className="tabular-nums">{c.code}</span> · <span className="[overflow-wrap:anywhere]">{c.requester.name}</span> · {statusWords(c.status)}
          </p>
          <h1 className="mt-1 font-display text-3xl leading-tight font-light text-fg [overflow-wrap:anywhere] md:text-4xl">{c.title}</h1>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {c.categoryName && <Chip tone="cool">{c.categoryName}</Chip>}
            {c.priority && <Chip tone={priorityTone(c.priority)}>{c.priority}</Chip>}
            {c.risk && <Chip>{c.risk} risk</Chip>}
            {c.department && <Chip>{c.department}</Chip>}
            {c.amountInr !== null && <Chip>{formatInr(c.amountInr)}</Chip>}
            {c.assignee && <Chip>{c.assignee.name}</Chip>}
            {due && <Chip tone={due.late ? 'danger' : 'neutral'}>{due.text}</Chip>}
            <Chip>{FROM[c.source]}</Chip>
          </div>
          {c.outcome && <p className="mt-3 text-sm text-fg-body">{c.outcome}</p>}
        </div>
        {manager && !ended && <CancelCase caseId={c.id} noun={noun} />}
      </header>

      {c.status === 'needs_info' && <AddDetails caseId={c.id} missing={file.review?.missing ?? []} />}
      {gate && <GateBanner gate={gate} canDecide={canDecide} who={roleName(gate.approver)} caseId={c.id} />}

      <section aria-label="Stages">
        <div className="hidden lg:block">
          <CaseCanvas states={states} names={stageLabels} person={person} selected={selected} onSelect={setSelected} />
        </div>
        <div className="glass rounded-lg p-4 lg:hidden">
          <StageDots states={states} names={stageLabels} />
          <p className="mt-2 text-sm text-fg-body">
            {ended ? statusWords(c.status) : `${stageLabels[STAGE_KEYS.indexOf(c.stage)]}: ${statusWords(c.status)}`}
          </p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <section className="glass min-w-0 rounded-lg p-5" aria-label="Case file">
          <h2 className="font-display text-xl font-light text-fg">
            <span className="text-fg-lead">What each stage</span> found
          </h2>
          <CaseTimeline rows={rows} states={states} lines={lines} requestText={file.request?.text} selected={selected} />
        </section>
        <aside className="min-w-0 space-y-4">
          {rows[7]!.status === 'done' && <CaseReportCard report={report} />}
          {report.work && <GoalReportCard report={report.work} actions={false} />}
          {c.goalId && (
            <Link to={`/goals/${c.goalId}`} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
              See the work step by step <ArrowRight className="size-4" aria-hidden />
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}
