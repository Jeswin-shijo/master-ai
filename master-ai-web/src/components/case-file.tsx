import type { CaseReport, StageKey } from '@onehuman/schemas';
import { dotLabel, showStageSummary, type DotState } from '@/lib/cases';
import { cn } from '@/lib/utils';

const BADGE: Record<DotState, string> = {
  done: 'bg-success-soft text-success',
  live: 'btn-action',
  waiting: 'bg-warning-soft text-warning pulse-dot',
  todo: 'text-fg-muted outline-1 -outline-offset-1 outline-dashed outline-line-20',
  skipped: 'bg-line-5 text-fg-muted',
  stopped: 'bg-danger-soft text-danger',
};
const WORDS: Record<DotState, string> = {
  done: 'text-success',
  live: 'text-fg-body',
  waiting: 'text-warning',
  todo: 'text-fg-muted',
  skipped: 'text-fg-muted',
  stopped: 'text-danger',
};

function took(minutes: number): string {
  return minutes < 60 ? `${Math.max(1, Math.round(minutes))} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} days`;
}

/** What each stage found, in sentences. The requester's own words stay text, however long or odd. */
export function CaseTimeline({
  rows,
  states,
  lines,
  requestText,
  selected,
}: {
  rows: CaseReport['stages'];
  states: DotState[];
  lines: Partial<Record<StageKey, string[]>>;
  requestText?: string;
  selected: StageKey | null;
}) {
  return (
    <ol className="mt-5">
      {rows.map((row, i) => {
        const state = states[i] ?? 'todo';
        return (
          <li
            key={row.stage}
            id={`stage-${row.stage}`}
            data-timeline-stage={row.stage}
            data-stage-state={state}
            className={cn('relative pb-6 pl-12 last:pb-0', selected === row.stage && 'rounded-md bg-line-5')}
          >
            <span className={cn('absolute top-0 left-0 grid size-8 place-items-center rounded-sm text-xs font-semibold tabular-nums', BADGE[state])}>{i + 1}</span>
            {i < rows.length - 1 && <span className="absolute top-10 bottom-1 left-4 w-px bg-line-10" aria-hidden />}
            <div className="flex flex-wrap items-baseline gap-x-3 pt-1">
              <h3 className="text-sm font-medium text-fg">{row.name}</h3>
              <span className={cn('text-xs', WORDS[state])}>{dotLabel(state)}</span>
              {row.minutes !== null && state === 'done' && <span className="text-xs text-fg-muted tabular-nums">{took(row.minutes)}</span>}
            </div>
            {row.summary && showStageSummary(state, (lines[row.stage] ?? []).length) && <p className="mt-1 text-sm text-fg-body [overflow-wrap:anywhere]">{row.summary}</p>}
            {(lines[row.stage] ?? []).length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-fg-lead">
                {lines[row.stage]!.map((line, j) => (
                  <li key={j} className="whitespace-pre-line [overflow-wrap:anywhere]">
                    {line}
                  </li>
                ))}
              </ul>
            )}
            {row.stage === 'request' && requestText && (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-fg-muted hover:text-fg">Their own words</summary>
                <p className="mt-2 max-h-64 overflow-y-auto rounded-md bg-line-5 p-3 whitespace-pre-line text-fg-body [overflow-wrap:anywhere]" data-testid="request-text">
                  {requestText}
                </p>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}
