import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import type { ReportPeriod } from '@onehuman/schemas';
import { CaseReportCard } from '@/components/case-report';
import { CopyReportButton, GoalReportCard, PrintButton, reportText } from '@/components/goal-report';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn, formatDateTime, formatInr } from '@/lib/utils';

const PERIODS: { value: ReportPeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

/** What got done, in plain words, ready to share with a client or print as a PDF. */
export function ReportsPage() {
  const [period, setPeriod] = useState<ReportPeriod>('week');
  const report = useQuery({ queryKey: ['reports', period], queryFn: () => api.reports.list(period) });
  const company = useSession((s) => s.tenant?.name);
  const data = report.data;
  const label = PERIODS.find((p) => p.value === period)!.label;

  const stats = data
    ? [
        { label: 'Requests', value: data.totals.cases, hint: `${data.totals.goals} agent job${data.totals.goals === 1 ? '' : 's'}` },
        { label: 'Need you', value: data.totals.needYou, hint: 'waiting or stuck', tone: data.totals.needYou ? 'text-warning' : undefined },
        { label: 'Things done', value: data.totals.actions, hint: `${data.totals.messages} message${data.totals.messages === 1 ? '' : 's'}` },
        { label: 'Calls to the team', value: data.totals.calls },
        { label: 'AI cost', value: formatInr(data.totals.costInr) },
      ]
    : [];
  const allText = data
    ? [
        `${company ?? 'Work'} report: ${label.toLowerCase()}`,
        '',
        ...data.cases.map((c) => `${c.code}: ${c.title}\n${c.text}\n`),
        ...data.goals.map((g) => `${reportText(g)}\n`),
      ]
        .join('\n')
        .trim()
    : '';

  return (
    <div className="space-y-6">
      <PageHeader
        lead="What got done,"
        title="in plain words."
        description="From your team and your agents. Share it with a client, or print it as a PDF."
        action={
          data && (data.goals.length > 0 || data.cases.length > 0) ? (
            <div className="flex gap-2 print:hidden">
              <CopyReportButton text={allText} label="Copy all" />
              <PrintButton />
            </div>
          ) : undefined
        }
      />
      <p className="hidden text-sm print:block">
        {company} · {label} · printed {formatDateTime(new Date().toISOString())}
      </p>

      <div className="flex flex-wrap gap-2 print:hidden" role="tablist" aria-label="Period">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            role="tab"
            aria-selected={period === p.value}
            onClick={() => setPeriod(p.value)}
            className={cn(
              'h-9 rounded-full px-4 text-sm transition-colors duration-300 max-sm:h-11',
              period === p.value ? 'nav-active text-fg' : 'text-fg-muted hover:bg-line-5 hover:text-fg',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {report.isLoading && <Spinner />}
      <ErrorNote error={report.error} />

      {data && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((s) => (
            <div key={s.label} className="glass rounded-lg px-4 py-3">
              <dt className="text-xs text-fg-muted">{s.label}</dt>
              <dd className={cn('mt-1 text-xl font-semibold tabular-nums text-fg', s.tone)}>{s.value}</dd>
              {s.hint && <dd className="text-xs text-fg-muted">{s.hint}</dd>}
            </div>
          ))}
        </dl>
      )}

      {data && data.goals.length === 0 && data.cases.length === 0 && (
        <EmptyState icon={<FileText />} title="Nothing in this period">
          Raise a request with New request. Its report appears here when it closes.
        </EmptyState>
      )}
      {data && data.cases.length > 0 && (
        <section className="space-y-4" aria-label="Requests">
          <h2 className="font-display text-xl font-light text-fg">Requests</h2>
          {data.cases.map((c) => (
            <CaseReportCard key={c.caseId} report={c} linked />
          ))}
        </section>
      )}
      {data && data.goals.length > 0 && (
        <section className="space-y-4" aria-label="Agent jobs">
          <h2 className="font-display text-xl font-light text-fg">Agent jobs</h2>
          {data.goals.map((g) => (
            <GoalReportCard key={g.goalId} report={g} linked />
          ))}
        </section>
      )}
    </div>
  );
}
