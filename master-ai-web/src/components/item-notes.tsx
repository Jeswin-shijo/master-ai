import { useMutation } from '@tanstack/react-query';
import type { ListNote } from '@onehuman/schemas';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { dayLabel, NOTE_LABELS } from '@/lib/lists';
import { cn, timeAgo } from '@/lib/utils';

/** Notes saying a follow-up stopped: nobody to reach, or a wrong number. "Call again" starts it again. */
const STOPPED: ListNote['kind'][] = ['unreachable', 'wrong_number'];

/**
 * What calls left on an item, newest first. Apply sets what a note proposes; a note with nothing to apply is only marked as seen.
 * A note saying the follow-up stopped offers "Call again" while it is new, and after it is seen for as long as it is the latest of its kind.
 */
export function ItemNotes({ notes, onDone }: { notes: ListNote[]; onDone: () => void }) {
  const apply = useMutation({ mutationFn: (id: string) => api.notes.apply(id), onSuccess: onDone });
  const dismiss = useMutation({ mutationFn: (id: string) => api.notes.dismiss(id), onSuccess: onDone });
  const callAgain = useMutation({ mutationFn: (id: string) => api.notes.callAgain(id), onSuccess: onDone });
  if (!notes.length) return null;
  const canCallAgain = (n: ListNote) => n.canCallAgain;
  const state = (n: ListNote) => (n.status === 'new' ? 'New from a call' : n.status === 'applied' ? `Applied by ${n.decidedBy ?? 'someone'}` : `Seen by ${n.decidedBy ?? 'someone'}`);
  return (
    <section aria-label="From calls" className="space-y-2">
      <h3 className="text-sm font-medium text-fg">From calls</h3>
      {notes.map((n) => (
        <div key={n.id} className={cn('rounded-sm border px-3 py-2 text-sm', n.status === 'new' ? 'border-primary/40 bg-primary-soft' : 'border-border')}>
          <p className="text-xs text-fg-muted">
            {NOTE_LABELS[n.kind]} · {n.speaker} · {timeAgo(n.at)} · {state(n)}
          </p>
          <p className="mt-1 text-fg">“{n.said}”</p>
          {n.promiseOn && <p className="text-fg-body">Promised for {dayLabel(n.promiseOn)}</p>}
          {n.proposed.length > 0 && (
            <ul className="mt-1 ml-4 list-disc text-fg-body">
              {n.proposed.map((p) => (
                <li key={p.field}>
                  {p.label}: {p.value}
                </li>
              ))}
            </ul>
          )}
          {(n.status === 'new' || canCallAgain(n)) && (
            <div className="mt-2 flex gap-2">
              {n.status === 'new' && n.proposed.length > 0 && (
                <Button size="sm" variant="success" loading={apply.isPending && apply.variables === n.id} onClick={() => apply.mutate(n.id)}>
                  Apply
                </Button>
              )}
              {n.status === 'new' && (
                <Button size="sm" variant="secondary" loading={dismiss.isPending && dismiss.variables === n.id} onClick={() => dismiss.mutate(n.id)}>
                  {n.proposed.length > 0 ? 'Dismiss' : 'Seen'}
                </Button>
              )}
              {canCallAgain(n) && (
                <Button size="sm" variant="secondary" loading={callAgain.isPending && callAgain.variables === n.id} onClick={() => callAgain.mutate(n.id)}>
                  Call again
                </Button>
              )}
            </div>
          )}
        </div>
      ))}
      <ErrorNote error={apply.error ?? dismiss.error ?? callAgain.error} />
    </section>
  );
}
