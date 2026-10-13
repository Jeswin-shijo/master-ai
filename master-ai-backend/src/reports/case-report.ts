import { STAGE_KEYS, type CaseReport, type CaseStatus, type GoalReport, type ResolvedLifecycle, type StageKey, type WorkReport } from '@onehuman/schemas';
import type { cases, caseStages } from '../db/schema';

export type CaseRow = typeof cases.$inferSelect;
export type StageRow = typeof caseStages.$inferSelect;

const WHERE: Record<CaseStatus, string> = {
  open: 'in progress',
  needs_info: 'waiting for more details',
  waiting_approval: 'waiting for approval',
  in_progress: 'being worked on',
  waiting_signoff: 'waiting for sign-off',
  closed: 'closed',
  rejected: 'rejected',
  cancelled: 'cancelled',
  escalated: 'with a person to take over',
};

/** A case's report in words: its 8 stages, the work and the stage-8 findings. */
export function buildCaseReport(c: CaseRow, stages: StageRow[], work: GoalReport | null, lc: ResolvedLifecycle): CaseReport {
  const latest = new Map<StageKey, StageRow>();
  for (const s of [...stages].sort((a, b) => a.attempt - b.attempt)) latest.set(s.stage, s);
  const nameOf = (key: StageKey) => lc.stages.find((s) => s.key === key)?.name ?? key;

  const timeline = STAGE_KEYS.map((key) => {
    const s = latest.get(key);
    const minutes = s?.startedAt && s.completedAt ? Math.round((s.completedAt.getTime() - s.startedAt.getTime()) / 60_000) : null;
    return { stage: key, name: s?.name ?? nameOf(key), status: s?.status ?? ('pending' as const), minutes, summary: s?.summary ?? null };
  });
  const report = c.file.report;
  return {
    caseId: c.id,
    code: c.code,
    title: c.title,
    status: c.status,
    outcome: c.outcome,
    text: report?.text ?? `${c.code} ${c.title} is ${WHERE[c.status]} (${nameOf(c.stage)}).`,
    slaMet: report?.slaMet ?? null,
    recurring: report?.recurring ?? null,
    stages: timeline,
    work,
    createdAt: c.createdAt.toISOString(),
    closedAt: c.closedAt?.toISOString() ?? null,
  };
}

const GOAL_FINISHED = new Set(['completed', 'partially_completed', 'failed', 'cancelled']);
const CASE_FINISHED = new Set<CaseStatus>(['closed', 'rejected', 'cancelled', 'escalated']);
const CASE_NEEDS_YOU = new Set<CaseStatus>(['needs_info', 'waiting_approval', 'waiting_signoff', 'escalated']);

/** A goal needs the owner when something failed or an approval waits. */
export function goalNeedsYou(r: GoalReport): boolean {
  return r.attention.length > 0 || r.pending.some((p) => p.startsWith('Waiting for your approval'));
}

/** Period totals: goals on their own plus cases, counting the work done inside each case. */
export function workTotals(goals: GoalReport[], cases: CaseReport[]): WorkReport['totals'] {
  const work = [...goals, ...cases.flatMap((c) => (c.work ? [c.work] : []))];
  return {
    goals: goals.length,
    cases: cases.length,
    finished: goals.filter((r) => GOAL_FINISHED.has(r.status)).length + cases.filter((c) => CASE_FINISHED.has(c.status)).length,
    needYou: goals.filter(goalNeedsYou).length + cases.filter((c) => CASE_NEEDS_YOU.has(c.status)).length,
    actions: work.reduce((n, r) => n + r.counts.actions, 0),
    messages: work.reduce((n, r) => n + r.counts.messages, 0),
    calls: work.reduce((n, r) => n + r.counts.calls, 0),
    costInr: Math.round(work.reduce((n, r) => n + r.costInr, 0) * 100) / 100,
  };
}
