import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Bot, CreditCard, Database, FileText, Mail, Phone, Search, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';
import type { ResolvedPack, WorkflowDef } from '@onehuman/schemas';
import { Spinner, EmptyState } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { useNewRequest } from '@/lib/new-request';
import { cn } from '@/lib/utils';

/** What a workflow's agents can do, shown as node icons like n8n template cards. */
function capabilityIcons(wf: WorkflowDef, pack: ResolvedPack): { icon: LucideIcon; label: string; tone: string }[] {
  const stepTools = new Set(wf.steps.flatMap((s) => pack.agents.find((a) => a.role === s.agent)?.tools ?? []));
  const primitives = [...stepTools].map((t) => pack.tools.find((x) => x.name === t)?.uses ?? t);
  const has = (prefix: string) => primitives.some((t) => t.startsWith(prefix));
  const out: { icon: LucideIcon; label: string; tone: string }[] = [];
  if (has('staff.delegate')) out.push({ icon: Phone, label: 'Phone calls to staff', tone: 'bg-warning-soft text-warning' });
  if (has('records')) out.push({ icon: Database, label: 'Records', tone: 'bg-accent-soft text-accent' });
  if (has('message')) out.push({ icon: Mail, label: 'Messages', tone: 'bg-info-soft text-info' });
  if (has('payment') || has('refund')) out.push({ icon: CreditCard, label: 'Payments', tone: 'bg-warning-soft text-warning' });
  if (has('document')) out.push({ icon: FileText, label: 'Documents', tone: 'bg-success-soft text-success' });
  if (pack.policies.some((p) => stepTools.has(p.action))) out.push({ icon: ShieldCheck, label: 'Owner approval', tone: 'bg-node text-fg' });
  return out.slice(0, 5);
}

/**
 * Workflow gallery, in the style of n8n's template library: every workflow the
 * installed industry pack ships, ready to run as a goal.
 */
export function WorkflowsPage() {
  const showNewRequest = useNewRequest((s) => s.show);
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });
  const pack = workspaces.data?.[0]?.pack;
  const [query, setQuery] = useState('');
  const start = (wf: { id: string; name: string }) => {
    const category = pack?.lifecycle?.categories.find((c) => c.workflow === wf.id)?.id;
    showNewRequest(category ? { category } : { text: wf.name });
  };
  const [category, setCategory] = useState<string>('All');

  const categories = useMemo(() => ['All', ...new Set((pack?.workflows ?? []).map((w) => w.category ?? 'Other'))], [pack]);
  const list = (pack?.workflows ?? []).filter((w) => {
    const q = query.toLowerCase();
    const matches = !q || `${w.name} ${w.description} ${w.keywords.join(' ')}`.toLowerCase().includes(q);
    return matches && (category === 'All' || (w.category ?? 'Other') === category);
  });

  if (workspaces.isLoading) return <Spinner />;
  if (!pack) return <EmptyState title="No industry pack installed" />;

  return (
    <div className="space-y-6">
      <section className="hero-glow -mx-4 rounded-2xl border border-border px-6 py-10 md:-mx-0 md:px-10">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/60 px-3 py-1 text-xs text-fg-muted">
          <Sparkles className="size-3.5 text-primary" aria-hidden /> {pack.name} pack · {pack.workflows.length} workflows
        </p>
        <h1 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-fg md:text-4xl">
          Discover workflows your <span className="text-primary">AI team</span> can run today
        </h1>
        <p className="mt-2 max-w-2xl text-fg-muted">Each one is a plan the orchestrator follows: agents act, the team is called, and you approve anything risky.</p>
        <div className="relative mt-6 max-w-xl">
          <Search className="pointer-events-none absolute top-3 left-3.5 size-4 text-fg-muted" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workflows: refund, follow-up, inspection…"
            className="h-11 w-full glass rounded-lg pr-4 pl-10 text-sm text-fg placeholder:text-fg-muted/70 focus:border-primary focus:outline-none"
            aria-label="Search workflows"
          />
        </div>
      </section>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Categories">
        {categories.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-sm transition-colors',
              category === c ? 'border-primary bg-primary-soft text-fg' : 'border-border text-fg-muted hover:border-fg-muted hover:text-fg',
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState title="No workflows match" />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
          {list.map((wf) => (
            <article key={wf.id} className="group flex flex-col glass rounded-lg p-5 transition-colors duration-300 hover:bg-line-5">
              <div className="flex -space-x-1.5">
                {capabilityIcons(wf, pack).map(({ icon: Icon, label, tone }) => (
                  <span key={label} title={label} className={cn('grid size-9 place-items-center rounded-lg ring-2 ring-surface', tone)}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                ))}
                {capabilityIcons(wf, pack).length === 0 && (
                  <span className="grid size-9 place-items-center rounded-lg bg-node text-fg"><Bot className="size-4" aria-hidden /></span>
                )}
              </div>
              <h2 className="mt-4 font-semibold text-fg">{wf.name}</h2>
              <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{wf.description}</p>
              <ol className="mt-3 space-y-1 text-xs text-fg-muted">
                {wf.steps.slice(0, 3).map((s, i) => (
                  <li key={s.key} className="flex items-center gap-2">
                    <span className="grid size-5 place-items-center rounded-full bg-node text-xs">{i + 1}</span>
                    <span className="truncate">{s.title}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-auto flex items-center justify-between pt-5">
                <span className="text-xs text-fg-muted">{wf.category ?? 'Other'}</span>
                <button onClick={() => start(wf)} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
                  Start <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
