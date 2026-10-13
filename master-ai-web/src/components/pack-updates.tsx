import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { api } from '@/lib/api';

/**
 * Shown when the platform's base packs gained agents or workflows after this
 * workspace was installed. Applying only adds; nothing the owner has is changed.
 */
export function PackUpdatesBanner() {
  const queryClient = useQueryClient();
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });
  const ws = workspaces.data?.[0];
  const updates = useQuery({ queryKey: ['pack-updates', ws?.id], queryFn: () => api.workspaces.updates(ws!.id), enabled: !!ws });
  const apply = useMutation({
    mutationFn: () => api.workspaces.applyUpdates(ws!.id),
    onSuccess: () => {
      for (const key of ['pack-updates', 'workspaces', 'agents', 'policy', 'routines']) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  const u = updates.data;
  if (!u) return null;
  const extras = u.tools.length + u.policies.length + u.kpis.length + (u.lifecycle?.categories.length ?? 0) + (u.lifecycle?.roles.length ?? 0);
  const routines = u.routines ?? [];
  const lifecycle = u.lifecycle?.whole ?? null;
  if (u.agents.length + u.workflows.length + routines.length + (u.playbooks?.length ?? 0) + extras + (lifecycle ? 1 : 0) === 0) return null;
  const callsTeam = u.agents.some((a) => a.tools.includes('staff.delegate'));

  return (
    <section className="rounded-xl border border-primary/40 bg-primary-soft p-5" aria-label="Workspace update">
      <div className="flex flex-wrap items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-fg">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-fg">
            {callsTeam ? 'Let your agents call the team' : 'New for your workspace'}
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            {callsTeam
              ? 'Your workspace was set up before phone delegation existed. Add it so agents can assign work to your team by phone, follow up and confirm.'
              : 'The platform gained these since you installed your industry pack. Adding them changes nothing you already have.'}
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {lifecycle && (
              <li><span className="font-medium text-fg">8-stage case lifecycle</span> <span className="text-fg-muted">· every request runs from {lifecycle.stages[0]!.name} to {lifecycle.stages[7]!.name}</span></li>
            )}
            {u.agents.map((a) => (
              <li key={a.role}><span className="font-medium text-fg">{a.name}</span> <span className="text-fg-muted">· agent · {a.description}</span></li>
            ))}
            {u.workflows.map((w) => (
              <li key={w.id}><span className="font-medium text-fg">{w.name}</span> <span className="text-fg-muted">· workflow · {w.description}</span></li>
            ))}
            {routines.map((r) => (
              <li key={r.id}><span className="font-medium text-fg">{r.name}</span> <span className="text-fg-muted">· daily check-in · {r.description}</span></li>
            ))}
            {(u.playbooks ?? []).map((p) => (
              <li key={p.id}><span className="font-medium text-fg">{p.title}</span> <span className="text-fg-muted">· playbook for your agents</span></li>
            ))}
            {extras > 0 && <li className="text-fg-muted">plus {extras} tool, policy or KPI change{extras === 1 ? '' : 's'}</li>}
          </ul>
        </div>
        <Button onClick={() => apply.mutate()} loading={apply.isPending}>Add to my workspace</Button>
      </div>
      <ErrorNote error={apply.error} className="mt-3" />
    </section>
  );
}
