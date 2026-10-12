import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play } from 'lucide-react';
import { PackSummary } from '@/components/pack-summary';
import { PackUpdatesBanner } from '@/components/pack-updates';
import { StatusBadge } from '@/components/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api';

/** Pack studio: what is installed, its lineage, and the exact Cedar policy in force. */
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
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge>v{ws.packVersion}</Badge>
        <Badge tone="info">{ws.pack.source}</Badge>
        <Badge>{ws.pack.lineage.join(' → ')}</Badge>
        {ws.pack.connectors.map((c) => (
          <Badge key={c} tone="warning">needs {c}</Badge>
        ))}
      </div>
      <ErrorNote error={toggle.error} />
      <PackUpdatesBanner />

      <PackSummary pack={ws.pack} />

      <Card>
        <CardHeader
          title={`Policy set v${policy.data?.version ?? '…'} (Cedar)`}
          description="This is the exact policy the engine evaluates for every agent action. The AI never decides what it may do."
        />
        <CardBody>
          {policy.isLoading ? <Spinner /> : <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed text-fg">{policy.data?.cedar}</pre>}
        </CardBody>
      </Card>
    </div>
  );
}
