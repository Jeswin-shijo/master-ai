import { useState } from 'react';
import { ChevronDown, Phone, PhoneMissed, PhoneOutgoing } from 'lucide-react';
import type { CallRecord, CallStage, Delegation } from '@onehuman/schemas';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';

export const STAGE_NAME: Record<CallStage, string> = { assign: 'Assign', follow_up: 'Follow-up', confirm: 'Confirm', checkin: 'Check-in' };

const DELEGATION_TONE: Record<string, BadgeTone> = {
  assigning: 'info',
  accepted: 'info',
  in_progress: 'info',
  done: 'success',
  declined: 'danger',
  blocked: 'danger',
  not_done: 'danger',
  unreachable: 'warning',
  cancelled: 'neutral',
};

const OUTCOME_TONE: Record<string, BadgeTone> = {
  accepted: 'success',
  on_track: 'success',
  done: 'success',
  needs_more_time: 'warning',
  no_answer: 'warning',
  unclear: 'warning',
  declined: 'danger',
  blocked: 'danger',
  not_done: 'danger',
};

export function CallRow({ call, defaultOpen = false }: { call: CallRecord; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = call.status === 'no_answer' ? PhoneMissed : call.status === 'completed' ? Phone : PhoneOutgoing;
  return (
    <li className="py-2.5">
      <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-full', call.status === 'no_answer' ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-accent')}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm text-fg">
            <span className="font-medium">{STAGE_NAME[call.stage]} call</span>
            {call.attempt > 1 && <span className="text-xs text-fg-muted">attempt {call.attempt}</span>}
            {call.outcome && <Badge tone={OUTCOME_TONE[call.outcome] ?? 'neutral'}>{call.outcome.replace(/_/g, ' ')}</Badge>}
            {(call.status === 'ringing' || call.status === 'in_progress') && <Badge tone="info"><span className="live-dot size-1.5 rounded-full bg-current" />{call.status === 'ringing' ? 'ringing' : 'on call'}</Badge>}
          </p>
          <p className="truncate text-xs text-fg-muted">{call.summary ?? formatDateTime(call.createdAt)}</p>
        </div>
        <span className="text-xs text-fg-muted">{timeAgo(call.createdAt)}</span>
        {call.transcript.length > 0 && <ChevronDown className={cn('size-4 text-fg-muted transition-transform', open && 'rotate-180')} aria-hidden />}
      </button>
      {open && call.transcript.length > 0 && (
        <div className="mt-3 ml-11 space-y-1.5">
          {call.transcript.map((l, i) => (
            <div key={i} className={cn('flex', l.speaker === 'person' ? 'justify-end' : 'justify-start')}>
              <p className={cn('max-w-[85%] rounded-2xl px-3 py-1.5 text-sm', l.speaker === 'person' ? 'rounded-br-sm bg-muted text-fg' : 'rounded-bl-sm bg-accent-soft text-fg')}>
                <span className="mb-0.5 block text-xs font-semibold tracking-wide text-fg-muted uppercase">{l.speaker === 'ai' ? 'AI assistant' : call.staffName}</span>
                {l.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

/** One piece of work with the person in charge: status, deadline and every call. */
export function DelegationCard({ delegation }: { delegation: Delegation }) {
  const d = delegation;
  return (
    <div className="glass rounded-lg">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <p className="text-xs text-fg-muted">
            Delegated to <span className="font-medium text-fg">{d.staffName}</span> · {d.staffTitle}
          </p>
          <h3 className="mt-0.5 font-semibold text-fg">{d.title}</h3>
        </div>
        <Badge tone={DELEGATION_TONE[d.status] ?? 'neutral'}>{d.status.replace(/_/g, ' ')}</Badge>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 px-5 pt-2 text-xs text-fg-muted">
        <span>Due: <span className="text-fg">{d.dueAt ? formatDateTime(d.dueAt) : 'to be agreed'}</span></span>
        {d.nextCallAt && d.stage !== 'closed' && <span>Next call: <span className="text-fg">{STAGE_NAME[d.stage as CallStage]} · {formatDateTime(d.nextCallAt)}</span></span>}
        <span>{d.calls.length} call{d.calls.length === 1 ? '' : 's'}</span>
      </div>
      {/* Cadence: assign → follow-up → confirm */}
      <ol className="mx-5 mt-4 grid grid-cols-3 gap-2" aria-label="Call cadence">
        {(['assign', 'follow_up', 'confirm'] as const).map((stage) => {
          const calls = d.calls.filter((c) => c.stage === stage);
          const last = calls[calls.length - 1];
          const good = last && ['accepted', 'on_track', 'done', 'needs_more_time'].includes(last.outcome ?? '');
          const bad = last && ['declined', 'blocked', 'not_done', 'unclear'].includes(last.outcome ?? '');
          return (
            <li key={stage} className={cn('rounded-lg border px-3 py-2 text-xs', good ? 'border-success/40 bg-success-soft' : bad ? 'border-danger/40 bg-danger-soft' : last ? 'border-info/40 bg-info-soft' : 'border-border bg-muted/40')}>
              <p className="font-semibold text-fg">{STAGE_NAME[stage]}</p>
              <p className="text-fg-muted">{last ? (last.outcome ?? last.status).replace(/_/g, ' ') : 'pending'}</p>
            </li>
          );
        })}
      </ol>
      {d.outcome && <p className="mx-5 mt-3 rounded-lg bg-muted px-3 py-2 text-sm text-fg">{d.outcome.summary}</p>}
      <ul className="mt-2 divide-y divide-line-10 px-5 pb-2">
        {d.calls.map((c, i) => (
          <CallRow key={c.id} call={c} defaultOpen={i === d.calls.length - 1} />
        ))}
      </ul>
    </div>
  );
}
