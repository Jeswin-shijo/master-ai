import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PhoneCall, PhoneOutgoing } from 'lucide-react';
import type { FollowUpInfo } from '@onehuman/schemas';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ErrorNote } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { followUpLine } from '@/lib/lists';
import { cn, timeAgo } from '@/lib/utils';

/** A list's follow-up calls: one switch each (all start off), who switched it and when, and "Call now". */
export function FollowUpsPanel({ listId }: { listId: string }) {
  const queryClient = useQueryClient();
  const followUps = useQuery({ queryKey: ['follow-ups', listId], queryFn: () => api.lists.followUps(listId) });
  // The "looking for items" line goes once the panel's data has refreshed after the sweep.
  const updatedAt = useRef(followUps.dataUpdatedAt);
  updatedAt.current = followUps.dataUpdatedAt;
  const [sweptAt, setSweptAt] = useState(0);
  const run = useMutation({ mutationFn: () => api.followUps.run(), onSuccess: () => setSweptAt(updatedAt.current) });
  const toggle = useMutation({
    mutationFn: (f: FollowUpInfo) => api.followUps.switch(f.key, !f.enabled),
    onSuccess: () => {
      run.reset();
      return queryClient.invalidateQueries({ queryKey: ['follow-ups', listId] });
    },
  });
  const list = followUps.data ?? [];
  if (!list.length) return null;
  return (
    <Card className="mb-4">
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-medium text-fg">
            <PhoneOutgoing className="size-4 text-primary" aria-hidden /> Follow-up calls
          </h2>
          {list.some((f) => f.enabled) && (
            <Button size="sm" variant="secondary" loading={run.isPending} onClick={() => run.mutate()}>
              <PhoneCall /> Call now
            </Button>
          )}
        </div>
        <ul className="divide-y divide-border">
          {list.map((f) => (
            <li key={f.key} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-fg">{f.label}</p>
                <p className="text-xs text-fg-muted">
                  {followUpLine(f)}
                  {f.changedBy && f.changedAt ? ` · switched ${f.enabled ? 'on' : 'off'} by ${f.changedBy}, ${timeAgo(f.changedAt)}` : ''}
                </p>
                {!f.canSwitch && <p className="text-xs text-fg-muted">Only the owner can switch on calls to customers and suppliers.</p>}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={f.enabled}
                aria-label={f.label}
                disabled={!f.canSwitch || (toggle.isPending && toggle.variables?.key === f.key)}
                onClick={() => toggle.mutate(f)}
                className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50', f.enabled ? 'bg-primary' : 'bg-muted')}
              >
                <span className={cn('absolute top-0.5 size-5 rounded-full bg-surface shadow transition-transform', f.enabled ? 'translate-x-5' : 'translate-x-0.5')} />
              </button>
            </li>
          ))}
        </ul>
        {run.isSuccess && followUps.dataUpdatedAt === sweptAt && <p className="text-xs text-fg-muted">Looking for items to call about now. Calls ring one at a time, inside calling hours.</p>}
        <ErrorNote error={followUps.error ?? toggle.error ?? run.error} />
      </CardBody>
    </Card>
  );
}
