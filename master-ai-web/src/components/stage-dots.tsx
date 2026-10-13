import { dotLabel, type DotState } from '@/lib/cases';
import { cn } from '@/lib/utils';

const DOT: Record<DotState, string> = {
  done: 'bg-success',
  live: 'btn-action',
  waiting: 'bg-warning pulse-dot',
  todo: 'border border-dashed border-line-20',
  skipped: 'bg-line-15',
  stopped: 'bg-line-10',
};

/** The 8 stages as dots: green done, warm live, dashed not started. Each dot says its state in words. */
export function StageDots({ states, names, className }: { states: DotState[]; names: string[]; className?: string }) {
  return (
    <ol className={cn('flex items-center gap-1', className)} aria-label="Stages">
      {states.map((s, i) => (
        <li key={i} className={cn('size-2.5 rounded-full', DOT[s])} title={`${names[i]}: ${dotLabel(s)}`}>
          <span className="sr-only">{`${names[i]}: ${dotLabel(s)}`}</span>
        </li>
      ))}
    </ol>
  );
}
