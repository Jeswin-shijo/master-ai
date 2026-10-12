import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import type { ReportPeriod } from '@onehuman/schemas';
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
        { label: 'Jobs', value: data.totals.goals, hint: `${data.totals.finished} finished` },
        { label: 'Need you', value: data.totals.needYou, hint: 'waiting or stuck', tone: data.totals.needYou ? 'text-warning' : undefined },
        { label: 'Things done', value: data.totals.actions, hint: `${data.totals.messages} message${data.totals.messages === 1 ? '' : 's'}` },
        { label: 'Calls to the team', value: data.totals.calls },
        { label: 'AI cost', value: formatInr(data.totals.costInr) },
      ]
    : [];
  const allText = data
    ? [`${company ?? 'Work'} report: ${label.toLowerCase()}`, '', ...data.goals.map((g) => `${reportText(g)}\n`)].join('\n').trim()
    : '';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="What your agents and team got done, in plain words. Share it with a client, or print it as a PDF."
        action={
          data && data.goals.length > 0 ? (
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
              'rounded-full border px-3 py-1 text-sm transition-colors',
              period === p.value ? 'border-primary bg-primary-soft text-fg' : 'border-border text-fg-muted hover:text-fg',
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
            <div key={s.label} className="rounded-xl border border-border bg-surface px-4 py-3">
              <dt className="text-xs text-fg-muted">{s.label}</dt>
              <dd className={cn('mt-1 text-xl font-semibold tabular-nums text-fg', s.tone)}>{s.value}</dd>
              {s.hint && <dd className="text-xs text-fg-muted">{s.hint}</dd>}
            </div>
          ))}
        </dl>
      )}

      {data?.goals.length === 0 && (
        <EmptyState icon={<FileText />} title="Nothing in this period">
          Give the company a goal from the command center; its report appears here when the work is done.
        </EmptyState>
      )}
      <div className="space-y-4">
        {data?.goals.map((g) => <GoalReportCard key={g.goalId} report={g} linked />)}
      </div>
    </div>
  );
}
