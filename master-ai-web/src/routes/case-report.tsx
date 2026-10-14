import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Users } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { caseReportText, caseReportView } from '@onehuman/sdk';
import { CopyReportButton, PrintButton } from '@/components/goal-report';
import { Chip } from '@/components/ui/chip';
import { ErrorNote, Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn, formatDateTime } from '@/lib/utils';

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold tracking-wide text-fg-muted uppercase print:text-black/70">{children}</h2>;
}

function Lines({ title, icon, tone, lines }: { title: string; icon: React.ReactNode; tone: string; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <section className="space-y-2 break-inside-avoid">
      <Heading>{title}</Heading>
      <ul className="space-y-1.5">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-2.5 text-sm text-fg print:text-black">
            <span className={cn('mt-0.5 shrink-0 [&_svg]:size-4', tone)}>{icon}</span>
            <span className="[overflow-wrap:anywhere]">{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A case's full report: what was asked, every stage, who decided, what was done
 * and how it ended. It reads well on screen and prints as a clean page (Print / PDF).
 */
export function CaseReportPage() {
  const { id = '' } = useParams();
  const company = useSession((s) => s.tenant?.name);
  const detail = useQuery({ queryKey: ['case', id], queryFn: () => api.cases.get(id) });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });

  if (detail.isLoading) return <Spinner />;
  if (detail.error || !detail.data) return <ErrorNote error={detail.error ?? new Error('This report was not found')} />;

  const d = detail.data;
  const lifecycle = (workspaces.data?.find((w) => w.id === d.case.workspaceId) ?? workspaces.data?.[0])?.pack.lifecycle;
  const v = caseReportView(d, {
    roleName: (rid) => (rid === 'owner' ? 'the owner' : (lifecycle?.roles.find((r) => r.id === rid)?.name ?? 'the right person')),
    priorityName: (p) => lifecycle?.priorities.find((x) => x.id === p)?.name,
    when: formatDateTime,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to={`/cases/${d.case.id}`} className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden /> Back to {v.code}
        </Link>
        <div className="flex gap-2">
          <CopyReportButton text={caseReportText(v, company)} />
          <PrintButton />
        </div>
      </div>

      <article className="glass space-y-6 rounded-lg p-6 sm:p-8 print:bg-white print:p-0 print:text-black print:shadow-none" aria-label={`${v.label} report`}>
        <header className="space-y-2 border-b border-line-10 pb-5 print:border-black/20">
          <p className="text-sm text-fg-muted print:text-black/70">
            {company ? `${company} · ` : ''}
            {v.label} report
          </p>
          <h1 className="font-display text-3xl leading-tight font-light text-fg [overflow-wrap:anywhere] print:text-black">
            <span className="tabular-nums text-fg-lead print:text-black/60">{v.code}</span> · {v.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-body print:text-black">
            <span className="contents print:hidden">
              <Chip>{v.status}</Chip>
              {v.onTime !== null && <Chip tone={v.onTime ? 'success' : 'danger'}>{v.onTime ? 'On time' : 'Late'}</Chip>}
            </span>
            <span className="hidden font-medium print:inline">
              {v.status}
              {v.onTime !== null && (v.onTime ? ' · on time' : ' · late')} ·
            </span>
            <span>{v.dates}</span>
          </div>
        </header>

        {v.summary.length > 0 && (
          <section className="space-y-1.5 text-sm text-fg print:text-black">
            {v.summary.map((s, i) => (
              <p key={i} className="[overflow-wrap:anywhere]">
                {s}
              </p>
            ))}
          </section>
        )}

        <section className="space-y-2 break-inside-avoid">
          <Heading>Details</Heading>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {v.details.map((x) => (
              <div key={x.label} className="min-w-0">
                <dt className="text-xs text-fg-muted print:text-black/60">{x.label}</dt>
                <dd className="text-fg [overflow-wrap:anywhere] print:text-black">{x.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="space-y-3">
          <Heading>Stages</Heading>
          <ol className="space-y-3">
            {v.stages.map((s) => (
              <li key={s.n} className="break-inside-avoid border-l-2 border-line-20 pl-4 print:border-black/30">
                <p className="text-sm text-fg print:text-black">
                  <span className="tabular-nums text-fg-muted print:text-black/60">{s.n}.</span> <span className="font-medium">{s.name}</span>
                  <span className="text-fg-muted print:text-black/70">
                    {' '}
                    · {s.status}
                    {s.took ? ` · ${s.took}` : ''}
                  </span>
                </p>
                {s.found.map((f, i) => (
                  <p key={i} className="mt-0.5 text-sm text-fg-body [overflow-wrap:anywhere] print:text-black/80">
                    {f}
                  </p>
                ))}
              </li>
            ))}
          </ol>
        </section>

        {v.decisions.length > 0 && (
          <section className="space-y-2 break-inside-avoid">
            <Heading>Decisions</Heading>
            <ul className="space-y-1.5 text-sm text-fg print:text-black">
              {v.decisions.map((x, i) => (
                <li key={i} className="[overflow-wrap:anywhere]">
                  {x}
                </li>
              ))}
            </ul>
          </section>
        )}

        {v.work && (
          <div className="grid gap-5">
            <Lines title="What was done" icon={<CheckCircle2 />} tone="text-success" lines={v.work.done} />
            <Lines title="Still in progress" icon={<Clock />} tone="text-info" lines={v.work.pending} />
            <Lines title="Needs your attention" icon={<AlertTriangle />} tone="text-warning" lines={v.work.attention} />
            <Lines title="People involved" icon={<Users />} tone="text-fg-muted" lines={v.work.people} />
          </div>
        )}

        <p className="hidden text-xs text-fg-muted print:block print:text-black/60">Printed {formatDateTime(new Date().toISOString())} from ONEHUMAN OS</p>
      </article>
    </div>
  );
}
