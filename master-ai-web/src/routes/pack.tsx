import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play } from 'lucide-react';
import { PackSummary } from '@/components/pack-summary';
import { PackUpdatesBanner } from '@/components/pack-updates';
import { StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { connectorName } from '@onehuman/sdk';
import { api } from '@/lib/api';

/** The business setup in everyday words; the exact rule code stays folded away for IT. */
export function PackPage() {
  const queryClient = useQueryClient();
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });
  const ws = workspaces.data?.[0];
  const policy = useQuery({ queryKey: ['policy', ws?.id], queryFn: () => api.workspaces.policy(ws!.id), enabled: !!ws });
  const toggle = useMutation({
    mutationFn: () => (ws!.status === 'paused' ? api.workspaces.resume(ws!.id) : api.workspaces.pause(ws!.id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
  });

  if (workspaces.isLoading) return <Spinner />;
  if (!ws) return <ErrorNote error={workspaces.error ?? new Error('No industry pack installed')} />;

  return (
    <div className="space-y-6">
      <PageHeader
        lead="Industry setup:"
        title={ws.pack.name}
        description={ws.pack.description}
        action={
          <div className="flex items-center gap-2">
            <StatusBadge status={ws.status} />
            <Button variant="secondary" size="sm" onClick={() => toggle.mutate()} loading={toggle.isPending}>
              {ws.status === 'paused' ? <><Play /> Resume workspace</> : <><Pause /> Pause workspace</>}
            </Button>
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="info">{ws.pack.source === 'registry' ? 'Ready-made for your industry' : 'Made for your business'}</Badge>
        {ws.pack.connectors.length > 0 && (
          <span className="text-fg-muted">Works best connected to: {ws.pack.connectors.map(connectorName).join(', ')}</span>
        )}
      </div>
      <ErrorNote error={toggle.error} />
      <PackUpdatesBanner />

      <PackSummary pack={ws.pack} />

      <details className="group glass rounded-lg">
        <summary className="cursor-pointer px-5 py-4 text-sm text-fg-muted select-none hover:text-fg">
          Technical details for your IT team: the exact rule code checked before every step (version {policy.data?.version ?? '…'})
        </summary>
        <div className="border-t border-border px-5 py-4">
          {policy.isLoading ? <Spinner /> : <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed text-fg">{policy.data?.cedar}</pre>}
        </div>
      </details>
    </div>
  );
}
