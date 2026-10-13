import { useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Clock, Copy, Printer, Users } from 'lucide-react';
import { Link } from 'react-router';
import type { GoalReport } from '@onehuman/schemas';
import { goalStatusWord as statusWord, reportText } from '@onehuman/sdk';
import { StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatInr } from '@/lib/utils';

export { reportText };

/** Copy one or more reports as text; shows "Copied" briefly. */
export function CopyReportButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? 'Copied' : label}
    </Button>
  );
}

export function PrintButton() {
  return (
    <Button variant="secondary" size="sm" onClick={() => window.print()}>
      <Printer /> Print / PDF
    </Button>
  );
}

function Section({ title, icon, lines, tone }: { title: string; icon: React.ReactNode; lines: string[]; tone: string }) {
  if (lines.length === 0) return null;
  return (
    <section className="space-y-2 break-inside-avoid">
      <h3 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{title}</h3>
      <ul className="space-y-2">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-2.5 text-sm text-fg">
            <span className={`mt-0.5 shrink-0 ${tone}`}>{icon}</span>
            <span className="whitespace-pre-line">{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What a goal achieved, in sentences a client understands: done, still in
 * progress, needs attention, and who was involved. No tool names or data.
 */
export function GoalReportCard({ report, linked, actions = true }: { report: GoalReport; linked?: boolean; actions?: boolean }) {
  const empty = report.done.length + report.pending.length + report.attention.length === 0;
  return (
    <article className="overflow-hidden glass rounded-lg break-inside-avoid print:border-black/20">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-semibold text-fg">
            {linked ? (
              <Link to={`/goals/${report.goalId}`} className="hover:underline">
                {report.text}
              </Link>
            ) : (
              'Report'
            )}
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            {statusWord(report.status)}
            {report.completedAt ? ` · finished ${formatDateTime(report.completedAt)}` : ` · started ${formatDateTime(report.createdAt)}`}
            {report.costInr > 0 && ` · ${formatInr(report.costInr)} AI cost`}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <StatusBadge status={report.status} />
          {actions && <CopyReportButton text={reportText(report)} />}
          {actions && !linked && <PrintButton />}
        </div>
      </header>
      <div className="grid gap-5 px-5 py-4">
        {empty && <p className="text-sm text-fg-muted">Nothing has been done yet.</p>}
        <Section title="What was done" icon={<CheckCircle2 className="size-4" />} tone="text-success" lines={report.done} />
        <Section title="Still in progress" icon={<Clock className="size-4" />} tone="text-info" lines={report.pending} />
        <Section title="Needs your attention" icon={<AlertTriangle className="size-4" />} tone="text-warning" lines={report.attention} />
        <Section title="People involved" icon={<Users className="size-4" />} tone="text-fg-muted" lines={report.people} />
      </div>
    </article>
  );
}
