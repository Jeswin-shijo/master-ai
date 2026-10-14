import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Bot, Check, CheckCircle2, Clock, Info, ScrollText, X } from 'lucide-react';
import { Link, useParams } from 'react-router';
import type { AgentTextChunk, Task, ToolCall } from '@onehuman/schemas';
import { ApprovalCard } from '@/components/approval-card';
import { DelegationCard } from '@/components/delegation-card';
import { GoalCanvas, type CanvasSelection } from '@/components/goal-canvas';
import { GoalReportCard } from '@/components/goal-report';
import { StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ErrorNote, Spinner } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn, formatDateTime, formatInr, timeAgo } from '@/lib/utils';

/** The agent's words while it decides its next step (server-sent events). */
function useAgentText(taskId: string, active: boolean): string {
  const token = useSession((s) => s.token);
  const [text, setText] = useState('');
  useEffect(() => {
    if (!active || !token) return;
    const source = new EventSource(api.taskStreamUrl(taskId, token));
    source.onmessage = (msg) => {
      const chunk = JSON.parse(msg.data as string) as AgentTextChunk;
      setText((t) => (chunk.done ? `${t}\n` : t + chunk.delta).slice(-1200));
    };
    return () => source.close();
  }, [taskId, active, token]);
  return text;
}

function PlanReview({ goalId, rationale }: { goalId: string; rationale: string }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const decide = useMutation({
    mutationFn: (approved: boolean) => api.goals.decidePlan(goalId, { approved, notes: notes || undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['goal', goalId] }),
  });
  return (
    <Card className="border-level-4/40 bg-warning-soft/40">
      <CardHeader title="Review the plan before it runs" description={rationale} />
      <CardBody className="space-y-3">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2} />
        <ErrorNote error={decide.error} />
        <div className="flex gap-2">
          <Button variant="success" onClick={() => decide.mutate(true)} loading={decide.isPending && decide.variables}>
            <Check /> Approve plan
          </Button>
          <Button variant="ghost" className="text-danger" onClick={() => decide.mutate(false)} loading={decide.isPending && !decide.variables}>
            <X /> Reject
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

const TONE_ICON = {
  done: <CheckCircle2 className="size-4 text-success" aria-hidden />,
  info: <Info className="size-4 text-info" aria-hidden />,
  pending: <Clock className="size-4 text-level-4" aria-hidden />,
  problem: <AlertTriangle className="size-4 text-danger" aria-hidden />,
};

/** One step, told in plain words: what was done (or why not), and what it found or sent. */
function ToolCallRow({ call }: { call: ToolCall }) {
  const n = call.narrative ?? { text: call.rationale || 'Step', short: '', tone: 'info' as const };
  const guarded = call.status === 'awaiting_approval' || call.status === 'blocked';
  return (
    <li className="flex gap-3 py-3">
      <span className="mt-0.5 shrink-0">{TONE_ICON[n.tone]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start gap-2">
          <p className={cn('min-w-0 flex-1 text-sm', n.tone === 'problem' ? 'text-danger' : 'text-fg')}>{n.text}</p>
          <span className="text-xs text-fg-muted">{timeAgo(call.executedAt ?? call.createdAt)}</span>
        </div>
        {n.items && n.items.length > 0 && (
          <ul className="mt-1.5 space-y-1 border-l-2 border-border pl-3 text-sm text-fg-muted">
            {n.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )}
        {guarded && call.decision && call.decision.reasons.length > 0 && (
          <p className="mt-1 text-xs text-fg-muted">Why it needs you: {call.decision.reasons.join(' · ')}</p>
        )}
      </div>
    </li>
  );
}

function TaskCard({ task, calls, children }: { task: Task; calls: ToolCall[]; children?: React.ReactNode }) {
  const active = task.status === 'running';
  const thinking = useAgentText(task.id, active);
  return (
    <Card>
      <CardHeader
        title={task.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <Bot className="size-3.5" aria-hidden /> {task.agentName} · {task.steps} step{task.steps === 1 ? '' : 's'}
          </span>
        }
        action={<StatusBadge status={task.status} />}
      />
      <CardBody className="space-y-3">
        {task.waitingOn && <p className="text-sm text-level-4">{task.waitingOn}</p>}
        {active && thinking && (
          <p className="rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap text-fg-muted" aria-live="polite">
            {thinking}
          </p>
        )}
        {children}
        {calls.length > 0 && <ul className="divide-y divide-line-10">{calls.map((c) => <ToolCallRow key={c.id} call={c} />)}</ul>}
        {task.output && <p className="rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm whitespace-pre-line text-fg">{task.output.summary}</p>}
      </CardBody>
    </Card>
  );
}

export function GoalDetailPage() {
  const { id = '' } = useParams();
  const detail = useQuery({ queryKey: ['goal', id], queryFn: () => api.goals.get(id), refetchInterval: (q) => (q.state.data?.goal.status === 'planning' ? 1500 : false) });
  const delegations = useQuery({ queryKey: ['delegations', id], queryFn: () => api.delegations.list(id) });
  const caseId = detail.data?.goal.caseId ?? null;
  // Work done for a case: people see the case, not the instructions written for the agents.
  const parent = useQuery({ queryKey: ['case', caseId], queryFn: () => api.cases.get(caseId!), enabled: !!caseId });
  const [picked, setPicked] = useState<CanvasSelection | null>(null);

  if (detail.isLoading) return <Spinner />;
  if (detail.error || !detail.data) return <ErrorNote error={detail.error ?? new Error('Goal not found')} />;
  const { goal, tasks, toolCalls, approvals, report } = detail.data;
  const delegs = delegations.data ?? [];

  // Default to whatever needs attention: plan review, an approval, a job with the team.
  const attention =
    tasks.find((t) => t.status === 'waiting_approval') ??
    tasks.find((t) => t.status === 'waiting_on_team') ??
    tasks.find((t) => t.status === 'running') ??
    tasks[tasks.length - 1];
  const selected: CanvasSelection =
    picked ?? (goal.status === 'awaiting_plan_approval' ? { kind: 'plan' } : attention ? { kind: 'task', id: attention.id } : { kind: 'goal' });

  const panel = (() => {
    switch (selected.kind) {
      case 'goal':
        return <GoalReportCard report={report} />;
      case 'plan':
        return goal.status === 'awaiting_plan_approval' && goal.plan ? (
          <PlanReview goalId={goal.id} rationale={goal.plan.rationale} />
        ) : (
          <Card>
            <CardHeader title="Orchestrator plan" description={goal.plan?.rationale ?? 'Planning…'} />
            <CardBody>
              <ol className="space-y-2 text-sm">
                {goal.plan?.tasks.map((t, i) => (
                  <li key={t.key} className="flex gap-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs text-fg-muted">{i + 1}</span>
                    <span>
                      <span className="font-medium text-fg">{t.title}</span>
                      <span className="block text-fg-muted">{t.description.split('\n')[0]}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        );
      case 'task': {
        const t = tasks.find((x) => x.id === selected.id);
        if (!t) return null;
        return (
          <TaskCard task={t} calls={toolCalls.filter((c) => c.taskId === t.id)}>
            {approvals.filter((a) => a.taskId === t.id && a.status === 'pending').map((a) => (
              <ApprovalCard key={a.id} approval={a} />
            ))}
            {delegs.filter((d) => d.taskId === t.id).map((d) => (
              <DelegationCard key={d.id} delegation={d} />
            ))}
          </TaskCard>
        );
      }
      case 'delegation': {
        const d = delegs.find((x) => x.id === selected.id);
        return d ? <DelegationCard delegation={d} /> : null;
      }
      case 'call': {
        const c = toolCalls.find((x) => x.id === selected.id);
        if (!c) return null;
        const approval = approvals.find((a) => a.toolCallId === c.id);
        return approval ? (
          <ApprovalCard approval={approval} />
        ) : (
          <Card>
            <CardBody>
              <ul>
                <ToolCallRow call={c} />
              </ul>
            </CardBody>
          </Card>
        );
      }
    }
  })();

  return (
    <div className="space-y-5">
      <Link to={caseId ? `/cases/${caseId}` : '/'} className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" /> {caseId ? `Back to ${parent.data?.case.code ?? 'the request'}` : 'Home'}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {caseId ? (
            <>
              <p className="text-sm text-fg-muted">The work, step by step</p>
              <h1 className="text-xl font-semibold tracking-tight text-fg">{parent.data ? `${parent.data.case.code} · ${parent.data.case.title}` : '\u00a0'}</h1>
            </>
          ) : (
            <h1 className="text-xl font-semibold tracking-tight text-fg">{goal.text}</h1>
          )}
          <p className="mt-1 text-sm text-fg-muted">
            Created {formatDateTime(goal.createdAt)}
            {goal.costInr > 0 && <> · {formatInr(goal.costInr)} AI cost</>}
            {delegs.length > 0 && (() => {
              const n = delegs.reduce((sum, d) => sum + d.calls.length, 0);
              return <> · {n} call{n === 1 ? '' : 's'} with the team</>;
            })()}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <StatusBadge status={goal.status} />
          <Link to={`/audit?goal=${goal.id}`} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
            <ScrollText className="size-4" /> Audit trail
          </Link>
        </div>
      </div>

      {goal.status === 'planning' && <Spinner label="The orchestrator is planning…" />}
      {goal.status === 'awaiting_plan_approval' && goal.plan && selected.kind !== 'plan' && <PlanReview goalId={goal.id} rationale={goal.plan.rationale} />}

      <div className="print:hidden">
        <GoalCanvas detail={detail.data} delegations={delegs} selected={selected} onSelect={setPicked} title={caseId ? (parent.data ? `${parent.data.case.code} · ${parent.data.case.title}` : 'This request') : undefined} />
      </div>

      {/* The report: what was done, in plain words. It is what prints. */}
      {selected.kind !== 'goal' && goal.status !== 'planning' && goal.status !== 'awaiting_plan_approval' && <GoalReportCard report={report} />}
      <div className="print:hidden">{panel}</div>
    </div>
  );
}
