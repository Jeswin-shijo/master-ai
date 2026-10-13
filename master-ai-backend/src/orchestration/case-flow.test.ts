import { describe, expect, it } from 'vitest';
import type { StageKey } from '@onehuman/schemas';
import { advance, startFlow, type FlowState, type StageResult } from './case-flow';

/** Run the flow with scripted stage results; unscripted stages finish "done". */
function run(script: Partial<Record<string, StageResult[]>> = {}): { steps: string[]; state: FlowState } {
  const queues = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...(v ?? [])]]));
  let state = startFlow();
  const steps: string[] = [];
  for (let guard = 0; state.next && guard < 30; guard++) {
    const stage: StageKey = state.next;
    const attempt = state.attempts[stage] ?? 1;
    steps.push(`${stage}#${attempt}`);
    state = advance(state, stage, queues[stage]?.shift() ?? { outcome: 'done' });
  }
  return { steps, state };
}

describe('case flow', () => {
  it('runs all 8 stages in order', () => {
    const { steps, state } = run();
    expect(steps).toEqual(['request#1', 'review#1', 'classify#1', 'assign#1', 'approve#1', 'execute#1', 'close#1', 'report#1']);
    expect(state.ending).toBe('closed');
  });

  it('goes straight to the report when the request is not eligible', () => {
    const { steps, state } = run({ review: [{ outcome: 'not_eligible', reason: 'Not eligible: internal wiring' }] });
    expect(steps).toEqual(['request#1', 'review#1', 'report#1']);
    expect(state).toMatchObject({ ending: 'rejected', reason: 'Not eligible: internal wiring' });
  });

  it('ends a rejected approval with the note', () => {
    const { steps, state } = run({ approve: [{ outcome: 'rejected', reason: 'Not approved: budget frozen' }] });
    expect(steps.at(-1)).toBe('report#1');
    expect(state).toMatchObject({ ending: 'rejected', reason: 'Not approved: budget frozen' });
  });

  it('runs the work and the check once more when the result is not accepted', () => {
    const { steps, state } = run({ close: [{ outcome: 'rework', reason: 'Vibration still high' }] });
    expect(steps.slice(-4)).toEqual(['close#1', 'execute#2', 'close#2', 'report#1']);
    expect(state.ending).toBe('closed');
    expect(state.reworkNote).toBe('Vibration still high');
  });

  it('escalates when the second attempt is not accepted either', () => {
    const { steps, state } = run({ close: [{ outcome: 'rework' }, { outcome: 'rework', reason: 'Still failing' }] });
    expect(steps.slice(-2)).toEqual(['close#2', 'report#1']);
    expect(state).toMatchObject({ ending: 'escalated', reason: 'Not accepted after a second attempt: Still failing' });
  });

  it('cancelling while waiting ends with the report', () => {
    const { steps, state } = run({ approve: [{ outcome: 'cancelled', reason: 'Customer withdrew' }] });
    expect(steps.slice(-2)).toEqual(['approve#1', 'report#1']);
    expect(state.ending).toBe('cancelled');
  });

  it('escalates an expired approval and cancels a request nobody completed', () => {
    expect(run({ approve: [{ outcome: 'expired' }] }).state.ending).toBe('escalated');
    expect(run({ review: [{ outcome: 'timed_out' }] }).state.ending).toBe('cancelled');
  });
});
