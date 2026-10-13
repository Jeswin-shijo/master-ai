import { STAGE_KEYS, type Case, type CaseStageStatus, type CaseStatus, type PriorityId, type StageKey } from '@onehuman/schemas';

/** The generic stage names (spec), for workspaces that name none of their own. */
export const GENERIC_STAGE_NAMES: Record<StageKey, string> = {
  request: 'Request / Event Created',
  review: 'Admin Review & Validation',
  classify: 'Classification & Priority',
  assign: 'Assignment',
  approve: 'Approval Gate',
  execute: 'Execution & Monitoring',
  close: 'Verification & Closure',
  report: 'Reporting & Continuous Improvement',
};

/** This organization's stage names, falling back to the generic ones. */
export function stageNames(lifecycle?: { stages: { key: StageKey; name: string }[] } | null): Record<StageKey, string> {
  const names = { ...GENERIC_STAGE_NAMES };
  for (const s of lifecycle?.stages ?? []) names[s.key] = s.name;
  return names;
}

export type DotState = 'done' | 'live' | 'waiting' | 'todo' | 'skipped' | 'stopped';

export const FINAL_STATUSES: readonly CaseStatus[] = ['closed', 'rejected', 'cancelled', 'escalated'];
export const WAITING_ON_PEOPLE: readonly CaseStatus[] = ['needs_info', 'waiting_approval', 'waiting_signoff'];

/** The list's mini stage bar, from the case alone. */
export function dotsFromCase(c: Pick<Case, 'stage' | 'status'>): DotState[] {
  if (c.status === 'closed') return STAGE_KEYS.map(() => 'done');
  if (FINAL_STATUSES.includes(c.status)) return STAGE_KEYS.map((k) => (k === 'report' ? 'done' : 'stopped'));
  const at = STAGE_KEYS.indexOf(c.stage);
  const current: DotState = WAITING_ON_PEOPLE.includes(c.status) ? 'waiting' : 'live';
  return STAGE_KEYS.map((_, i) => (i < at ? 'done' : i === at ? current : 'todo'));
}

/** The exact state of each stage, from the case report's timeline. */
export function dotsFromStages(stages: { status: CaseStageStatus }[]): DotState[] {
  return stages.map(({ status }) => {
    switch (status) {
      case 'done':
        return 'done';
      case 'skipped':
        return 'skipped';
      case 'failed':
        return 'stopped';
      case 'pending':
        return 'todo';
      case 'running':
        return 'live';
      default:
        return 'waiting';
    }
  });
}

const DOT_WORDS: Record<DotState, string> = {
  done: 'Done',
  live: 'In progress',
  waiting: 'Waiting for a person',
  todo: 'Not started',
  skipped: 'Not needed',
  stopped: 'Stopped',
};

export function dotLabel(state: DotState): string {
  return DOT_WORDS[state];
}

const STATUS_WORDS: Record<CaseStatus, string> = {
  open: 'Open',
  needs_info: 'Needs details',
  waiting_approval: 'Waiting for approval',
  in_progress: 'In progress',
  waiting_signoff: 'Waiting for sign-off',
  closed: 'Closed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  escalated: 'With a person',
};

export function statusWords(status: CaseStatus): string {
  return STATUS_WORDS[status];
}

/** Chip tone for a priority: P1 is critical (red), the rest are neutral. */
export function priorityTone(p: PriorityId | null): 'danger' | 'waiting' | 'neutral' {
  return p === 'P1' ? 'danger' : p === 'P2' ? 'waiting' : 'neutral';
}

export interface CaseFilters {
  q?: string;
  stage?: StageKey | '';
  priority?: PriorityId | '';
  /** open: not ended; waiting: on a person; closed: ended. */
  status?: 'open' | 'waiting' | 'closed' | '';
  assignee?: string;
}

export function caseMatches(c: Case, f: CaseFilters): boolean {
  const q = f.q?.trim().toLowerCase();
  if (q && ![c.code, c.title, c.requester.name].some((s) => s.toLowerCase().includes(q))) return false;
  if (f.stage && c.stage !== f.stage) return false;
  if (f.priority && c.priority !== f.priority) return false;
  if (f.status === 'open' && FINAL_STATUSES.includes(c.status)) return false;
  if (f.status === 'waiting' && !WAITING_ON_PEOPLE.includes(c.status)) return false;
  if (f.status === 'closed' && !FINAL_STATUSES.includes(c.status)) return false;
  const who = f.assignee?.trim().toLowerCase();
  if (who && !(c.assignee?.name ?? '').toLowerCase().includes(who)) return false;
  return true;
}

/** Home: open cases by stage, what waits on people, and what is within a day of its deadline. */
export function homeBuckets(cases: Case[], now: Date) {
  const open = cases.filter((c) => !FINAL_STATUSES.includes(c.status));
  const byStage = Object.fromEntries(STAGE_KEYS.map((k) => [k, 0])) as Record<StageKey, number>;
  for (const c of open) byStage[c.stage]++;
  const dayAhead = now.getTime() + 24 * 3_600_000;
  const atRisk = open
    .filter((c) => c.resolveBy && Date.parse(c.resolveBy) <= dayAhead)
    .sort((a, b) => Date.parse(a.resolveBy!) - Date.parse(b.resolveBy!));
  return { open: open.length, byStage, waiting: open.filter((c) => WAITING_ON_PEOPLE.includes(c.status)), atRisk };
}

/** "Due in 3 hours", "Overdue by 2 days", or null without a deadline. */
export function dueWords(resolveBy: string | null, now: Date): { text: string; late: boolean } | null {
  if (!resolveBy) return null;
  const ms = Date.parse(resolveBy) - now.getTime();
  const hours = Math.round(Math.abs(ms) / 3_600_000);
  const span = hours < 1 ? 'less than an hour' : hours < 48 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${Math.round(hours / 24)} days`;
  return ms >= 0 ? { text: `Due in ${span}`, late: false } : { text: `Overdue by ${span}`, late: true };
}
