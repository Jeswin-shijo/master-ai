import { Bot, Database, GitBranch, Gauge, ShieldCheck } from 'lucide-react';
import type { ResolvedPack } from '@onehuman/schemas';
import { clearanceLabel, ruleText, toolLabel } from '@onehuman/sdk';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';

function title(icon: React.ReactNode, text: string) {
  return (
    <span className="inline-flex items-center gap-2">
      {icon} {text}
    </span>
  );
}

/**
 * What an industry setup gives the business, in everyday words for owners and
 * their clients: the AI team (each one's mission, what it never handles and what
 * it may do), what is kept track of, the rules, the ready-made jobs and what is
 * measured. No tool or code names.
 */
export function PackSummary({ pack }: { pack: ResolvedPack }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <Card className="lg:col-span-2">
        <CardHeader
          title={title(<Bot className="size-4" />, `Your AI team (${pack.agents.length})`)}
          description="Each assistant has its own job and limits. Anything beyond what it may do on its own waits for your OK."
        />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          {pack.agents.map((a) => {
            const clearance = clearanceLabel(a.autonomy);
            return (
              <div key={a.role} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-fg">{a.name}</p>
                  <span title={clearance.long}>
                    <Badge tone="primary">{clearance.short}</Badge>
                  </span>
                </div>
                <p className="mt-1 text-sm text-fg-muted">{a.job?.mission ?? a.description}</p>
                {!!a.job?.never.length && (
                  <>
                    <p className="mt-2 text-xs text-fg-muted">Never handles:</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-fg" aria-label={`What the ${a.name} never handles`}>
                      {a.job.never.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="mt-2 text-xs text-fg-muted">Can:</p>
                <ul className="mt-1 flex flex-wrap gap-1" aria-label={`What the ${a.name} can do`}>
                  {a.tools.map((t) => (
                    <li key={t} className="rounded-md bg-muted px-2 py-0.5 text-xs text-fg">
                      {toolLabel(t, pack)}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={title(<Database className="size-4" />, 'What it keeps track of')} />
        <CardBody>
          <ul className="space-y-2 text-sm">
            {pack.entities.map((e) => (
              <li key={e.name}>
                <span className="font-medium text-fg">{e.plural_label ?? `${e.label}s`}</span>
                <span className="text-fg-muted">
                  {' '}
                  — {e.fields.slice(0, 6).map((f) => f.label.toLowerCase()).join(', ')}
                  {e.fields.length > 6 ? ', …' : ''}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={title(<ShieldCheck className="size-4" />, 'Your rules')} description="Checked before every step. The AI cannot change them." />
        <CardBody>
          {pack.policies.length === 0 && <p className="text-sm text-fg-muted">No extra rules yet.</p>}
          <ul className="space-y-2 text-sm">
            {pack.policies.map((p, i) => (
              <li key={p.id ?? i}>
                <p className="text-fg">{ruleText(p, pack)}</p>
                {p.reason && <p className="text-xs text-fg-muted">{p.reason}</p>}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={title(<GitBranch className="size-4" />, 'Ready-made jobs')} />
        <CardBody>
          <ul className="space-y-3 text-sm">
            {pack.workflows.map((w) => (
              <li key={w.id}>
                <p className="font-medium text-fg">{w.name}</p>
                <p className="text-fg-muted">{w.steps.map((s) => s.title).join(' → ')}</p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={title(<Gauge className="size-4" />, 'What it measures')} />
        <CardBody>
          <ul className="space-y-2 text-sm">
            {pack.kpis.map((k) => (
              <li key={k.id} className="flex items-start justify-between gap-3">
                <span className="text-fg">{k.name}</span>
                {!k.source && <Badge>needs a connected app</Badge>}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
