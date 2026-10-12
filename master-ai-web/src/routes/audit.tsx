import { useMutation, useQuery } from '@tanstack/react-query';
import { Link2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { summarizeEvent, type AuditEventType } from '@onehuman/schemas';
import { JsonView } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

/**
 * Audit explorer. Every action is an append-only, hash-chained event; filter
 * by goal to replay a task step by step: inputs, policy decisions, approver,
 * result.
 */
export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const goalId = params.get('goal') ?? undefined;
  const events = useQuery({ queryKey: ['audit', goalId], queryFn: () => api.audit.list({ goalId, limit: 200 }) });
  const verify = useMutation({ mutationFn: api.audit.verify });

  return (
    <div className="space-y-4">
      <PageHeader
        title={goalId ? 'Goal replay' : 'Audit log'}
        description="Append-only and hash-chained: each event's hash covers the one before it, so any change to history is detectable."
        action={
          <Button variant="secondary" onClick={() => verify.mutate()} loading={verify.isPending}>
            <ShieldCheck /> Verify chain
          </Button>
        }
      />
      {verify.data && (
        <div className={verify.data.ok ? 'rounded-md border border-success/30 bg-success-soft px-4 py-3 text-sm text-success' : 'rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger'} role="status">
          {verify.data.ok ? (
            <span className="inline-flex items-center gap-2"><ShieldCheck className="size-4" /> Intact: {verify.data.checked} events verified, head {verify.data.headHash.slice(0, 16)}…</span>
          ) : (
            <span className="inline-flex items-center gap-2"><ShieldAlert className="size-4" /> Broken at event #{verify.data.firstBrokenSeq}</span>
          )}
        </div>
      )}
      <ErrorNote error={events.error ?? verify.error} />
      {goalId && (
        <p className="text-sm">
          <Link to={`/goals/${goalId}`} className="text-primary hover:underline">Open goal</Link>
          <span className="text-fg-muted"> · </span>
          <button className="text-primary hover:underline" onClick={() => setParams({})}>Show all events</button>
        </p>
      )}
      <Card>
        {events.isLoading ? (
          <Spinner />
        ) : events.data?.length === 0 ? (
          <EmptyState title="No events yet" />
        ) : (
          <ol className="divide-y divide-border">
            {events.data?.map((e) => (
              <li key={e.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-12 font-mono text-xs text-fg-muted">#{e.seq}</span>
                  <Badge tone={e.type.includes('blocked') || e.type.includes('rejected') ? 'danger' : e.type.startsWith('approval') ? 'warning' : e.actorKind === 'agent' ? 'info' : 'neutral'}>{e.type}</Badge>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">{summarizeEvent(e.type as AuditEventType, e.payload)}</span>
                  <span className="text-xs text-fg-muted">{e.actorKind} · {formatDateTime(e.createdAt)}</span>
                  {!goalId && e.goalId && (
                    <button className="text-xs text-primary hover:underline" onClick={() => setParams({ goal: e.goalId! })}>
                      replay goal
                    </button>
                  )}
                </div>
                <details className="mt-1 pl-14 text-xs">
                  <summary className="cursor-pointer text-fg-muted hover:text-fg">
                    <Link2 className="mr-1 inline size-3" aria-hidden />
                    {e.hash.slice(0, 12)}… ← {e.prevHash.slice(0, 12)}…
                  </summary>
                  <JsonView value={e.payload} className="mt-2" />
                </details>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
