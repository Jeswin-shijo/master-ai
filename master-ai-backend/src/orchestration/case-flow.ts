import type { StageKey } from '@onehuman/schemas';
import type { CaseEnding } from './shared';

/** How a stage ended, as its workflow reports it. */
export type StageOutcome = 'done' | 'not_eligible' | 'rejected' | 'blocked' | 'expired' | 'rework' | 'cancelled' | 'escalated' | 'timed_out';

export interface StageResult {
  outcome: StageOutcome;
  /** A plain sentence; becomes the case outcome when the case ends here. */
  reason?: string;
}

export interface FlowState {
  next: StageKey | null;
  attempts: Partial<Record<StageKey, number>>;
  ending: CaseEnding | null;
  reason: string | null;
  /** Why the first result was not accepted, for the second attempt. */
  reworkNote: string | null;
}

const MAIN: StageKey[] = ['request', 'review', 'classify', 'assign', 'approve', 'execute', 'close'];

const ENDS: Partial<Record<StageOutcome, CaseEnding>> = {
  not_eligible: 'rejected',
  rejected: 'rejected',
  blocked: 'rejected',
  cancelled: 'cancelled',
  timed_out: 'cancelled',
  expired: 'escalated',
  escalated: 'escalated',
};

export function startFlow(): FlowState {
  return { next: 'request', attempts: {}, ending: null, reason: null, reworkNote: null };
}

/**
 * What runs after `stage` returned `result`. Every path ends with the report:
 * a closed, rejected, cancelled or escalated case is still reported.
 */
export function advance(state: FlowState, stage: StageKey, result: StageResult): FlowState {
  if (stage === 'report') return { ...state, next: null };
  if (state.ending) return { ...state, next: 'report' };

  const ending = ENDS[result.outcome];
  if (ending) return { ...state, ending, reason: result.reason ?? null, next: 'report' };

  if (result.outcome === 'rework') {
    const executed = state.attempts.execute ?? 1;
    if (stage !== 'close' || executed >= 2) {
      const note = `Not accepted after a second attempt${result.reason ? `: ${result.reason}` : ''}`;
      return { ...state, ending: 'escalated', reason: note, next: 'report' };
    }
    return {
      ...state,
      attempts: { ...state.attempts, execute: executed + 1, close: (state.attempts.close ?? 1) + 1 },
      reworkNote: result.reason ?? null,
      next: 'execute',
    };
  }

  if (stage === 'close') return { ...state, ending: 'closed', next: 'report' };
  return { ...state, next: MAIN[MAIN.indexOf(stage) + 1] ?? 'report' };
}
