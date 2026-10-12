import { Bot, Database, GitBranch, Gauge, ShieldCheck } from 'lucide-react';
import type { ResolvedPack } from '@onehuman/schemas';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatInr, humanize } from '@/lib/utils';

function policyText(p: ResolvedPack['policies'][number]): string {
  const what = p.action === '*' ? 'Every action' : p.action;
  const who = p.agent ? ` (${humanize(p.agent)})` : '';
  if (p.forbid) return `${what}${who} is forbidden`;
  if (p.forbid_above) return `${what}${who} above ${formatInr(p.forbid_above.amount)} is forbidden`;
  if (p.require_approval_above) return `${what}${who} above ${formatInr(p.require_approval_above.amount)} needs approval`;
  return `${what}${who} needs approval`;
}

/** What an Industry Pack sets up: agents, records, workflows, rules and KPIs. */
export function PackSummary({ pack }: { pack: ResolvedPack }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <Card className="lg:col-span-2">
        <CardHeader title={<span className="inline-flex items-center gap-2"><Bot className="size-4" /> Agents ({pack.agents.length})</span>} description="Each agent has its own identity, tools, budget and clearance level." />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          {pack.agents.map((a) => (
            <div key={a.role} className="rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-fg">{a.name}</p>
                <Badge tone={a.autonomy >= 4 ? 'warning' : 'primary'}>clearance L{a.autonomy}</Badge>
              </div>
              <p className="mt-1 text-sm text-fg-muted">{a.description}</p>
              <p className="mt-2 flex flex-wrap gap-1">
                {a.tools.map((t) => (
                  <code key={t} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-fg-muted">{t}</code>
                ))}
              </p>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={<span className="inline-flex items-center gap-2"><Database className="size-4" /> Records ({pack.entities.length})</span>} />
        <CardBody>
          <ul className="space-y-2 text-sm">
            {pack.entities.map((e) => (
              <li key={e.name}>
                <span className="font-medium text-fg">{e.label}</span>
                <span className="text-fg-muted"> — {e.fields.slice(0, 6).map((f) => f.label).join(', ')}{e.fields.length > 6 ? '…' : ''}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={<span className="inline-flex items-center gap-2"><ShieldCheck className="size-4" /> Approval rules ({pack.policies.length})</span>} />
        <CardBody>
          <ul className="space-y-2 text-sm">
            {pack.policies.map((p, i) => (
              <li key={p.id ?? i}>
                <p className="text-fg">{policyText(p)}</p>
                {p.reason && <p className="text-xs text-fg-muted">{p.reason}</p>}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={<span className="inline-flex items-center gap-2"><GitBranch className="size-4" /> Workflows ({pack.workflows.length})</span>} />
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
        <CardHeader title={<span className="inline-flex items-center gap-2"><Gauge className="size-4" /> KPIs ({pack.kpis.length})</span>} />
        <CardBody>
          <ul className="space-y-2 text-sm">
            {pack.kpis.map((k) => (
              <li key={k.id} className="flex items-start justify-between gap-3">
                <span className="text-fg">{k.name}</span>
                {!k.source && <Badge>needs connector</Badge>}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
