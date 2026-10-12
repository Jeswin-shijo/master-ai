import type { AutonomyLevel, RiskFactor } from '@onehuman/schemas';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { cn, humanize, LEVEL_LABELS } from '@/lib/utils';

const LEVEL_CLASS: Record<number, string> = {
  1: 'bg-level-1/12 text-level-1',
  2: 'bg-level-2/12 text-level-2',
  3: 'bg-level-3/12 text-level-3',
  4: 'bg-level-4/15 text-level-4',
  5: 'bg-level-5/12 text-level-5',
};

/** Autonomy level of a decided action (1 observe … 5 blocked). */
export function LevelBadge({ level, className }: { level: AutonomyLevel | number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', LEVEL_CLASS[level], className)}>
      L{level} · {LEVEL_LABELS[level as AutonomyLevel]}
    </span>
  );
}

const STATUS_TONE: Record<string, BadgeTone> = {
  planning: 'info',
  awaiting_plan_approval: 'warning',
  running: 'info',
  pending: 'neutral',
  waiting_approval: 'warning',
  waiting_on_team: 'info',
  awaiting_approval: 'warning',
  paused: 'warning',
  completed: 'success',
  executed: 'success',
  approved: 'success',
  edited: 'success',
  partially_completed: 'warning',
  escalated: 'warning',
  proposed: 'neutral',
  skipped: 'neutral',
  expired: 'neutral',
  cancelled: 'neutral',
  rejected: 'danger',
  blocked: 'danger',
  failed: 'danger',
  active: 'success',
  retired: 'neutral',
};

const LABELS: Record<string, string> = {
  awaiting_plan_approval: 'Plan review',
  waiting_on_team: 'With the team',
  waiting_approval: 'Needs approval',
  awaiting_approval: 'Waiting for you',
  executed: 'Done',
  completed: 'Done',
  partially_completed: 'Partly done',
  escalated: 'Needs you',
  blocked: 'Not allowed',
  failed: "Couldn't do",
  rejected: 'You said no',
  proposed: 'Planned',
  running: 'In progress',
};

export function StatusBadge({ status }: { status: string }) {
  const label = LABELS[status] ?? humanize(status);
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'}>
      {(status === 'running' || status === 'planning' || status === 'waiting_on_team') && <span className="live-dot size-1.5 rounded-full bg-current" aria-hidden />}
      {label}
    </Badge>
  );
}

/** Risk score bar with the factors that produced it. */
export function RiskMeter({ score, factors, compact }: { score: number; factors?: RiskFactor[]; compact?: boolean }) {
  const tone = score < 35 ? 'bg-level-2' : score < 75 ? 'bg-level-3' : 'bg-level-4';
  return (
    <div className={cn('space-y-2', compact && 'space-y-1')}>
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label="Risk score">
          <div className={cn('h-full rounded-full', tone)} style={{ width: `${Math.max(3, score)}%` }} />
        </div>
        <span className="w-14 text-right font-mono text-xs text-fg-muted">risk {score}</span>
      </div>
      {!compact && factors && factors.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {factors.map((f) => (
            <li key={f.factor} className="rounded border border-border px-1.5 py-0.5 text-xs text-fg-muted" title={f.detail}>
              {f.factor} <span className="font-mono">+{f.points}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function JsonView({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre className={cn('max-h-64 overflow-auto rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed text-fg', className)}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
