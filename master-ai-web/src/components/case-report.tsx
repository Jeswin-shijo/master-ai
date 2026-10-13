import { Link } from 'react-router';
import type { CaseReport } from '@onehuman/schemas';
import { CopyReportButton } from '@/components/goal-report';
import { Chip } from '@/components/ui/chip';
import { statusWords } from '@/lib/cases';
import { formatDateTime } from '@/lib/utils';

/** Stage 8's report, in words a client understands. */
export function CaseReportCard({ report, linked }: { report: CaseReport; linked?: boolean }) {
  const text = [`${report.code}: ${report.title}`, report.text, report.outcome].filter(Boolean).join('\n\n');
  return (
    <article className="glass overflow-hidden rounded-lg break-inside-avoid" aria-label={`Report for ${report.code}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-10 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs text-fg-muted tabular-nums">{report.code}</p>
          <h2 className="font-medium text-fg [overflow-wrap:anywhere]">
            {linked ? (
              <Link to={`/cases/${report.caseId}`} className="hover:underline">
                {report.title}
              </Link>
            ) : (
              report.title
            )}
          </h2>
          <p className="mt-0.5 text-sm text-fg-lead">
            {statusWords(report.status)}
            {report.closedAt ? ` · finished ${formatDateTime(report.closedAt)}` : ` · raised ${formatDateTime(report.createdAt)}`}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {report.slaMet !== null && <Chip tone={report.slaMet ? 'success' : 'danger'}>{report.slaMet ? 'On time' : 'Late'}</Chip>}
          <CopyReportButton text={text} />
        </div>
      </header>
      <div className="space-y-3 px-5 py-4 text-sm">
        <p className="whitespace-pre-line text-fg-body [overflow-wrap:anywhere]">{report.text}</p>
        {report.outcome && <p className="text-fg">{report.outcome}</p>}
        {report.recurring && <p className="text-warning">{report.recurring.note}</p>}
      </div>
    </article>
  );
}
