import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, Clock, PencilLine, ShieldCheck, X } from 'lucide-react';
import { Link } from 'react-router';
import type { ApprovalRequest } from '@onehuman/schemas';
import { readableFields } from '@onehuman/sdk';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { signDecision } from '@/lib/device-key';
import { formatInr, timeAgo } from '@/lib/utils';
import { RiskMeter, StatusBadge } from './status';

/**
 * One approval request: the action, why the policy engine stopped it, the
 * evidence, and approve / edit / reject. Every decision is signed with this
 * device's key before it is sent.
 */
export function ApprovalCard({ approval, compact }: { approval: ApprovalRequest; compact?: boolean }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'view' | 'edit' | 'reject'>('view');
  const [notes, setNotes] = useState('');
  const [argsText, setArgsText] = useState(() => JSON.stringify(approval.args, null, 2));
  const [argsError, setArgsError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: async (decision: 'approved' | 'rejected' | 'edited') => {
      let editedArgs: Record<string, unknown> | undefined;
      if (decision === 'edited') editedArgs = JSON.parse(argsText) as Record<string, unknown>;
      const signed = await signDecision({ approvalId: approval.id, decision, notes: notes || undefined, editedArgs });
      return api.approvals.decide(approval.id, { decision, notes: notes || undefined, editedArgs, ...signed });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['approvals'] });
      if (approval.goalId) void queryClient.invalidateQueries({ queryKey: ['goal', approval.goalId] });
    },
  });

  const pending = approval.status === 'pending';
  const submitEdit = () => {
    try {
      JSON.parse(argsText);
      setArgsError(null);
      decide.mutate('edited');
    } catch {
      setArgsError('Arguments must be valid JSON');
    }
  };

  return (
    <article className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <Bot className="size-3.5" aria-hidden />
            <span>{approval.agentName}</span>
            <span aria-hidden>·</span>
            <span>{timeAgo(approval.createdAt)}</span>
          </div>
          <h3 className="text-base font-semibold text-fg">{approval.summary}</h3>
        </div>
        <StatusBadge status={approval.status} />
      </div>

      <div className="space-y-4 px-5 py-4">
        <RiskMeter score={approval.riskScore} factors={compact ? undefined : approval.factors} />

        <ul className="space-y-1 text-sm">
          {approval.reasons.map((r) => (
            <li key={r} className="flex gap-2 text-fg">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-level-4" aria-hidden />
              {r}
            </li>
          ))}
        </ul>

        {approval.rationale && (
          <blockquote className="border-l-2 border-primary/40 pl-3 text-sm text-fg-muted">“{approval.rationale}”</blockquote>
        )}

        {!compact && (
          <details className="group text-sm">
            <summary className="cursor-pointer text-fg-muted select-none hover:text-fg">Details and what was done before</summary>
            <dl className="mt-3 grid gap-2 sm:grid-cols-[10rem_1fr]">
              {readableFields(approval.args).map((f) => (
                <div key={f.label} className="contents">
                  <dt className="text-fg-muted">{f.label}</dt>
                  <dd className="break-words text-fg">{f.value}</dd>
                </div>
              ))}
              {approval.evidence.map((e, i) => (
                <div key={i} className="contents">
                  <dt className="text-fg-muted">{e.label}</dt>
                  <dd className="break-words whitespace-pre-line text-fg">{e.value}</dd>
                </div>
              ))}
              <dt className="text-fg-muted">AI cost so far</dt>
              <dd>{formatInr(approval.costSoFarInr)}</dd>
            </dl>
          </details>
        )}

        {!pending && (
          <p className="text-sm text-fg-muted">
            {approval.decidedAt ? `Decided ${timeAgo(approval.decidedAt)}` : 'Closed'}
            {approval.decisionNotes ? ` — “${approval.decisionNotes}”` : ''}
            {approval.signature && <span className="ml-2 inline-flex items-center gap-1 text-success"><ShieldCheck className="size-3.5" /> signed</span>}
          </p>
        )}

        {pending && mode === 'edit' && (
          <div className="space-y-2">
            <Textarea value={argsText} onChange={(e) => setArgsText(e.target.value)} rows={8} className="font-mono text-xs" aria-label="Edited arguments" />
            {argsError && <p className="text-sm text-danger">{argsError}</p>}
          </div>
        )}
        {pending && mode !== 'view' && (
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={mode === 'reject' ? 'Tell the agent what to do instead (it will revise)' : 'Note for the record (optional)'}
            rows={2}
          />
        )}
        <ErrorNote error={decide.error} />
      </div>

      {pending && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          {mode === 'view' && (
            <>
              <Button variant="success" onClick={() => decide.mutate('approved')} loading={decide.isPending && decide.variables === 'approved'}>
                <Check /> Approve
              </Button>
              {approval.kind === 'action' && (
                <Button variant="secondary" onClick={() => setMode('edit')}>
                  <PencilLine /> Edit
                </Button>
              )}
              <Button variant="ghost" className="text-danger" onClick={() => setMode('reject')}>
                <X /> Reject
              </Button>
            </>
          )}
          {mode === 'edit' && (
            <>
              <Button variant="success" onClick={submitEdit} loading={decide.isPending}>
                <Check /> Approve edited
              </Button>
              <Button variant="ghost" onClick={() => setMode('view')}>Cancel</Button>
            </>
          )}
          {mode === 'reject' && (
            <>
              <Button variant="danger" onClick={() => decide.mutate('rejected')} loading={decide.isPending}>
                <X /> Reject and send back
              </Button>
              <Button variant="ghost" onClick={() => setMode('view')}>Cancel</Button>
            </>
          )}
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-fg-muted">
            <Clock className="size-3.5" aria-hidden /> expires {new Date(approval.expiresAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
          {compact && approval.goalId && (
            <Link to={`/goals/${approval.goalId}`} className="text-xs text-primary hover:underline">
              View goal
            </Link>
          )}
        </div>
      )}
    </article>
  );
}
