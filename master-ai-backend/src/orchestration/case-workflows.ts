import {
  CancellationScope,
  ChildWorkflowFailure,
  ChildWorkflowCancellationType,
  condition,
  defineSignal,
  executeChild,
  ParentClosePolicy,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import type { Activities } from './activities';
import { advance, stageFailed, startFlow, type StageResult } from './case-flow';
import {
  SIGNALS,
  stageWorkflowId,
  type CancelCaseSignal,
  type CaseWorkflowInput,
  type GateDecisionSignal,
  type GateName,
  type StageWorkflowInput,
} from './shared';

/**
 * Cases: one workflow per case, one child per stage attempt. A crash, a
 * deploy or a week waiting for details or an approval never loses progress.
 */

const db = proxyActivities<Activities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 5, initialInterval: '1s', backoffCoefficient: 2 },
});

/** Stages that may call the model. */
const model = proxyActivities<Activities>({
  startToCloseTimeout: '10 minutes',
  retry: { maximumAttempts: 3, initialInterval: '5s', backoffCoefficient: 2 },
});

export const gateDecision = defineSignal<[GateDecisionSignal]>(SIGNALS.gateDecision);
export const infoAdded = defineSignal(SIGNALS.infoAdded);
export const cancelCase = defineSignal<[CancelCaseSignal]>(SIGNALS.cancelCase);
const stagePause = defineSignal(SIGNALS.pause);
const stageResume = defineSignal(SIGNALS.resume);

/** Rounds of "please send the missing details" before a person takes over. */
const MAX_INFO_ROUNDS = 3;

export async function caseWorkflow(input: CaseWorkflowInput): Promise<{ ending: string | null }> {
  let cancelled = null as CancelCaseSignal | null;
  setHandler(cancelCase, (s) => {
    cancelled ??= s ?? {};
  });

  let state = startFlow();
  while (state.next) {
    const stage = state.next;
    if (cancelled && !state.ending) {
      state = advance(state, stage, { outcome: 'cancelled', reason: cancelled.reason ?? 'Cancelled by the owner.' });
      continue;
    }
    if (stage === 'report') await db.finishCase({ ...input, ending: state.ending ?? 'closed', reason: state.reason });
    const attempt = state.attempts[stage] ?? 1;
    let result: StageResult;
    try {
      result = await executeChild(stageWorkflow, {
        workflowId: stageWorkflowId(input.caseId, stage, attempt),
        args: [{ ...input, stage, attempt, ...(stage === 'execute' && state.reworkNote ? { reworkNote: state.reworkNote } : {}) }],
        parentClosePolicy: ParentClosePolicy.TERMINATE,
      });
    } catch (err) {
      // A broken stage must not strand the case: a person takes over and the report still runs.
      if (!(err instanceof ChildWorkflowFailure)) throw err;
      result = stageFailed(stage);
    }
    state = advance(state, stage, result);
  }
  return { ending: state.ending };
}

export async function stageWorkflow(input: StageWorkflowInput): Promise<StageResult> {
  let paused = false;
  let cancelled = false;
  let infoCount = 0;
  const decisions = new Map<string, GateDecisionSignal>();
  setHandler(stagePause, () => {
    paused = true;
  });
  setHandler(stageResume, () => {
    paused = false;
  });
  setHandler(cancelCase, () => {
    cancelled = true;
  });
  setHandler(infoAdded, () => {
    infoCount++;
  });
  setHandler(gateDecision, (d) => {
    decisions.set(d.approvalId, d);
  });

  /** Wait out a kill switch; a resume re-checks, since another switch may still be on. */
  const hold = async () => {
    while (paused && !cancelled) {
      await condition(() => !paused || cancelled);
      if (!cancelled) paused = await db.isPaused(input);
    }
  };
  const stop = async (): Promise<StageResult> => {
    await db.completeStage({ ...input, status: 'skipped', summary: 'Cancelled.' });
    return { outcome: 'cancelled' };
  };

  const review = async (): Promise<StageResult> => {
    for (let round = 0; ; round++) {
      const seen = infoCount;
      const r = await model.runStage(input);
      if (r.outcome === 'done') return { outcome: 'done' };
      if (r.outcome === 'not_eligible') return { outcome: 'not_eligible', reason: r.reason };
      if (round >= MAX_INFO_ROUNDS) {
        await db.completeStage({ ...input, status: 'failed', summary: 'Details still missing after three requests.' });
        return { outcome: 'escalated', reason: 'Details still missing after three requests.' };
      }
      const got = await condition(() => infoCount > seen || cancelled, r.waitMs);
      if (cancelled) return stop();
      if (!got) {
        await db.completeStage({ ...input, status: 'failed', summary: 'No reply with the missing details.' });
        return { outcome: 'timed_out', reason: 'No reply with the missing details.' };
      }
    }
  };

  const gate = async (which: GateName): Promise<StageResult> => {
    const g = await db.openGate({ ...input, gate: which });
    if (g.status === 'paused') {
      // A kill switch went on during this stage: wait for resume, then ask again.
      paused = true;
      await hold();
      if (cancelled) return stop();
      return gate(which);
    }
    if (g.status === 'not_required') return { outcome: 'done' };
    if (g.status === 'blocked') return { outcome: which === 'proceed' ? 'blocked' : 'escalated', reason: g.reason };
    const decided = await condition(() => decisions.has(g.approvalId) || cancelled, g.ttlMs);
    if (cancelled) return stop();
    if (!decided) {
      await db.closeGate({ ...input, gate: which, approvalId: g.approvalId, decision: 'expired' });
      return { outcome: 'expired', reason: 'No decision before the approval expired.' };
    }
    const d = decisions.get(g.approvalId)!;
    await db.closeGate({ ...input, gate: which, approvalId: g.approvalId, decision: d.decision, ...(d.notes && { notes: d.notes }) });
    if (d.decision === 'approved') return { outcome: 'done' };
    const note = d.notes ? `: ${d.notes}` : '.';
    return which === 'proceed' ? { outcome: 'rejected', reason: `Not approved${note}` } : { outcome: 'rework', reason: `Sign-off refused${note}` };
  };

  const execute = async (): Promise<StageResult> => {
    const started = await db.startExecution(input);
    const scope = new CancellationScope();
    let finished = false;
    let failed = false;
    const work = scope.run(() =>
      executeChild('goalWorkflow', {
        workflowId: started.workflowId,
        args: [{ tenantId: input.tenantId, goalId: started.goalId, autoStart: true }],
        parentClosePolicy: ParentClosePolicy.TERMINATE,
        cancellationType: ChildWorkflowCancellationType.TRY_CANCEL,
      }),
    );
    work.then(
      () => (finished = true),
      () => {
        finished = true;
        failed = true;
      },
    );
    await condition(() => finished || cancelled);
    if (cancelled && !finished) {
      scope.cancel();
      await work.catch(() => undefined);
      await db.cancelExecution({ ...input, goalId: started.goalId });
      return stop();
    }
    await db.finishExecution({ ...input, goalId: started.goalId, failed });
    return { outcome: 'done' };
  };

  const close = async (): Promise<StageResult> => {
    const v = await model.verifyClose(input);
    if (!v.verified) return { outcome: 'rework', reason: v.reason ?? 'The result does not match the request.' };
    return gate('close');
  };

  const begun = await db.beginStage(input);
  paused = paused || begun.paused;
  await hold();
  if (cancelled) return stop();

  switch (input.stage) {
    case 'review':
      return review();
    case 'approve':
      return gate('proceed');
    case 'execute':
      return execute();
    case 'close':
      return close();
    default:
      await model.runStage(input);
      return { outcome: 'done' };
  }
}
