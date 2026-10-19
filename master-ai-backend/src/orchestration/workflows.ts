import {
  condition,
  defineSignal,
  executeChild,
  ParentClosePolicy,
  proxyActivities,
  setHandler,
  sleep,
} from '@temporalio/workflow';
import type { Activities } from './activities';
import {
  SIGNALS,
  type ApprovalDecisionSignal,
  type CallStageName,
  type CallUpdateSignal,
  type CheckinCallInput,
  type DelegationWorkflowInput,
  type FollowUpCallInput,
  type FollowUpSweepInput,
  type GoalWorkflowInput,
  type JobScheduleInput,
  type JobSweepInput,
  type PlanDecisionSignal,
  type RoutineRunInput,
  type TaskOutcome,
  type TaskWorkflowInput,
} from './shared';

type CallResult = Awaited<ReturnType<Activities['callResult']>>;

/**
 * Durable workflows. Every goal and every task is a Temporal workflow, so a
 * crash, a deploy or a three-day wait for the owner's approval never loses
 * progress: the workflow resumes exactly where it stopped.
 */

const db = proxyActivities<Activities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 5, initialInterval: '1s', backoffCoefficient: 2 },
});

const model = proxyActivities<Activities>({
  startToCloseTimeout: '15 minutes',
  retry: { maximumAttempts: 3, initialInterval: '5s', backoffCoefficient: 2 },
});

export const planDecision = defineSignal<[PlanDecisionSignal]>(SIGNALS.planDecision);
export const approvalDecision = defineSignal<[ApprovalDecisionSignal]>(SIGNALS.approvalDecision);
export const pause = defineSignal(SIGNALS.pause);
export const resume = defineSignal(SIGNALS.resume);
export const callUpdate = defineSignal<[CallUpdateSignal]>(SIGNALS.callUpdate);

const PLAN_REVIEW_TIMEOUT = '7 days';
const MAX_QUALITY_RETRIES = 2;

/** Goal → plan → (owner reviews plan) → tasks in dependency order → summary. */
export async function goalWorkflow(input: GoalWorkflowInput): Promise<{ status: string; outcomes: Record<string, TaskOutcome> }> {
  let decision: PlanDecisionSignal | undefined = input.autoStart ? { approved: true } : undefined;
  setHandler(planDecision, (d) => {
    decision ??= d;
  });

  const plan = await model.planGoal(input);

  if (!input.autoStart) {
    const decided = await condition(() => decision !== undefined, PLAN_REVIEW_TIMEOUT);
    if (!decided || !decision!.approved) {
      const reason = decided ? `Plan rejected${decision!.notes ? `: ${decision!.notes}` : ''}` : 'Plan was not reviewed within 7 days';
      await db.markGoalRunning({ ...input, approved: false, notes: reason });
      await db.finishGoal({ ...input, outcomes: {}, cancelledReason: reason });
      return { status: 'cancelled', outcomes: {} };
    }
    await db.markGoalRunning({ ...input, approved: true });
  }

  const outcomes: Record<string, TaskOutcome> = {};
  const pending = new Set(plan.tasks.map((t) => t.key));
  while (pending.size > 0) {
    const ready = plan.tasks.filter((t) => pending.has(t.key) && t.dependsOn.every((d) => d in outcomes));
    if (ready.length === 0) break; // defensive: unsatisfiable dependencies
    ready.forEach((t) => pending.delete(t.key));
    await Promise.all(
      ready.map(async (t) => {
        const blockedBy = t.dependsOn.find((d) => outcomes[d] !== 'completed');
        if (blockedBy) {
          await db.skipTask({ tenantId: input.tenantId, goalId: input.goalId, taskId: t.id, reason: `Depends on "${blockedBy}", which did not complete` });
          outcomes[t.key] = 'skipped';
          return;
        }
        const result = await executeChild(taskWorkflow, {
          workflowId: `task-${t.id}`,
          args: [{ tenantId: input.tenantId, goalId: input.goalId, taskId: t.id }],
          parentClosePolicy: ParentClosePolicy.TERMINATE,
        });
        outcomes[t.key] = result.status;
      }),
    );
  }

  await db.finishGoal({ ...input, outcomes });
  return { status: 'finished', outcomes };
}

/**
 * One agent working one task: propose → policy → run / wait for approval /
 * blocked → repeat, then a quality check before the task counts as done.
 */
export async function taskWorkflow(input: TaskWorkflowInput): Promise<{ status: TaskOutcome }> {
  let paused = false;
  const decisions = new Map<string, ApprovalDecisionSignal>();
  setHandler(pause, () => {
    paused = true;
  });
  setHandler(resume, () => {
    paused = false;
  });
  setHandler(approvalDecision, (d) => {
    decisions.set(d.approvalId, d);
  });

  const start = await db.startTask(input);
  if (start.paused) paused = true;
  let qualityRetries = 0;

  for (;;) {
    if (paused) {
      await db.setTaskPaused({ ...input, paused: true });
      await condition(() => !paused);
      await db.setTaskPaused({ ...input, paused: false });
    }

    const step = await model.agentStep(input);

    if (step.kind === 'stop') {
      await db.escalateTask({ ...input, reason: step.reason });
      return { status: 'escalated' };
    }
    if (step.kind === 'invalid') continue; // feedback was recorded; the step limit bounds retries
    if (step.kind === 'finish') {
      const quality = await model.qualityCheck({ ...input, output: step.output });
      if (quality.pass) {
        await db.completeTask({ ...input, output: step.output });
        return { status: 'completed' };
      }
      if (++qualityRetries > MAX_QUALITY_RETRIES) {
        await db.escalateTask({ ...input, reason: `Quality check failed: ${quality.feedback}` });
        return { status: 'escalated' };
      }
      continue;
    }

    const { level, delegate } = await db.evaluateAction({ ...input, toolCallId: step.toolCallId });
    const run = async (approvalId?: string) => {
      if (!delegate) {
        await db.executeAction({ ...input, toolCallId: step.toolCallId, approvalId });
        return;
      }
      // Work handed to a person in charge: the call cadence runs as a child workflow.
      const { delegationId } = await db.startDelegation({ ...input, toolCallId: step.toolCallId });
      if (!delegationId) return; // nobody fits; the agent sees why on its next step
      const result = await executeChild(delegationWorkflow, {
        workflowId: `delegation-${delegationId}`,
        args: [{ tenantId: input.tenantId, delegationId }],
        parentClosePolicy: ParentClosePolicy.TERMINATE,
      });
      await db.finishDelegationAction({ ...input, toolCallId: step.toolCallId, result });
    };
    if (level <= 3) {
      await run();
      continue;
    }
    if (level === 5) continue; // blocked and logged; the agent sees why on its next step

    const approval = await db.requestApproval({ ...input, toolCallId: step.toolCallId });
    const decided = await condition(() => decisions.has(approval.approvalId), approval.ttlMs);
    if (!decided) {
      await db.expireApproval({ ...input, approvalId: approval.approvalId });
      await db.escalateTask({ ...input, reason: 'Approval request expired without a decision' });
      return { status: 'escalated' };
    }
    await db.resumeAfterApproval(input);
    const d = decisions.get(approval.approvalId)!;
    if (d.decision === 'approved' || d.decision === 'edited') await run(approval.approvalId);
    // Rejected: the owner's notes are already in the task feedback; the agent revises.
  }
}

/**
 * Work delegated to a person in charge, run by phone:
 *   call 1 assigns it and agrees a deadline,
 *   call 2 follows up before the deadline,
 *   call 3 confirms it is done.
 * Unanswered calls are retried; declined, blocked, not done or unreachable
 * outcomes close the delegation and go back to the agent (and the owner).
 */
export async function delegationWorkflow(input: DelegationWorkflowInput) {
  const answered = new Set<string>();
  const ended = new Set<string>();
  setHandler(callUpdate, ({ callId, event }) => {
    answered.add(callId);
    if (event === 'ended') ended.add(callId);
  });

  const plan = await db.delegationPlan(input);

  const callStage = async (stage: CallStageName): Promise<CallResult | null> => {
    for (let attempt = 1; attempt <= plan.maxAttempts; attempt++) {
      for (let wait = await db.waitBeforeCall(input); wait > 0; wait = await db.waitBeforeCall(input)) await sleep(wait);
      const placed = await db.placeCall({ ...input, stage, attempt });
      let result = placed.result;
      if (!result) {
        const picked = await condition(() => answered.has(placed.callId), plan.ringTimeoutMs);
        if (picked) await condition(() => ended.has(placed.callId), plan.talkTimeoutMs);
        if (!ended.has(placed.callId)) await db.markNoAnswer({ ...input, callId: placed.callId });
        result = await db.callResult({ ...input, callId: placed.callId });
      }
      if (result.answered) return result;
      if (attempt < plan.maxAttempts) await sleep(plan.retryMs);
    }
    return null;
  };

  // 1. Assign
  const assigned = await callStage('assign');
  if (!assigned) return db.closeDelegation({ ...input, status: 'unreachable', result: null });
  if (assigned.outcome !== 'accepted') {
    return db.closeDelegation({ ...input, status: assigned.outcome === 'declined' ? 'declined' : 'blocked', result: assigned });
  }
  await db.applyCallOutcome({ ...input, result: assigned });

  // 2. Follow up (skipped silently if they can't be reached; the confirm call still happens)
  await sleep(await db.scheduleNextCall({ ...input, stage: 'follow_up' }));
  const followUp = await callStage('follow_up');
  if (followUp?.outcome === 'done') return db.closeDelegation({ ...input, status: 'done', result: followUp });
  if (followUp?.outcome === 'blocked') return db.closeDelegation({ ...input, status: 'blocked', result: followUp });
  if (followUp) await db.applyCallOutcome({ ...input, result: followUp });

  // 3. Confirm
  await sleep(await db.scheduleNextCall({ ...input, stage: 'confirm' }));
  const confirmed = await callStage('confirm');
  if (!confirmed) return db.closeDelegation({ ...input, status: 'unreachable', result: null });
  return db.closeDelegation({ ...input, status: confirmed.outcome === 'done' ? 'done' : 'not_done', result: confirmed });
}

/**
 * One run of a routine (its time came round, or "Run now"): everyone who has
 * not reported today gets a check-in call, all at once, then the owner gets
 * the day's summary.
 */
export async function routineRunWorkflow(input: RoutineRunInput) {
  const run = await db.startRoutineRun(input);
  await Promise.all(
    run.entryIds.map((entryId) =>
      executeChild(checkinCallWorkflow, {
        workflowId: `checkin-${entryId}`,
        args: [{ tenantId: input.tenantId, entryId }],
        parentClosePolicy: ParentClosePolicy.TERMINATE,
      }),
    ),
  );
  await db.finishRoutineRun(input);
}

/**
 * One person's check-in by phone: call inside calling hours, wait for the
 * answer, retry if they miss it or ask to be called back, and mark the day
 * missed if every attempt fails. A report filled in by hand meanwhile stops it.
 */
export async function checkinCallWorkflow(input: CheckinCallInput) {
  const answered = new Set<string>();
  const ended = new Set<string>();
  setHandler(callUpdate, ({ callId, event }) => {
    answered.add(callId);
    if (event === 'ended') ended.add(callId);
  });

  const plan = await db.checkinPlan(input);
  for (let attempt = 1; attempt <= plan.maxAttempts; attempt++) {
    let wait = await db.checkinWait(input);
    while (wait > 0) {
      await sleep(wait);
      wait = await db.checkinWait(input);
    }
    if (wait < 0) break;
    const placed = await db.placeCheckinCall({ ...input, attempt });
    if (!placed.callId) return;
    if (!placed.done) {
      const callId = placed.callId;
      const picked = await condition(() => answered.has(callId), plan.ringTimeoutMs);
      if (picked) await condition(() => ended.has(callId), plan.talkTimeoutMs);
      if (!ended.has(callId)) await db.endCheckinCall({ ...input, callId });
    }
    const result = await db.checkinResult({ ...input, callId: placed.callId });
    if (result.reported) return;
    if (attempt < plan.maxAttempts) await sleep(plan.retryMs);
  }
  await db.markCheckinMissed(input);
}

export { caseWorkflow, stageWorkflow } from './case-workflows';

/**
 * The company's follow-up sweep: one call at a time until nothing is due
 * inside calling hours, the day's cap is reached, another sweep's call is on,
 * or a call could not be placed (the next would most likely fail the same way).
 */
export async function followUpSweepWorkflow(input: FollowUpSweepInput) {
  for (let i = 0; i < 200; i++) {
    const next = await db.pickFollowUp(input);
    if (!next) return;
    const call = await executeChild(followUpCallWorkflow, {
      workflowId: `follow-up-call-${next.callId}`,
      args: [{ tenantId: input.tenantId, callId: next.callId }],
      parentClosePolicy: ParentClosePolicy.TERMINATE,
    });
    // `?.`: a call workflow started before this change returns nothing.
    if (call?.failed) return;
  }
}

/** One follow-up call: ring, wait for an answer and the end, then set when the item is due again. `failed` when it could not be placed. */
export async function followUpCallWorkflow(input: FollowUpCallInput): Promise<{ failed: boolean }> {
  const answered = new Set<string>();
  const ended = new Set<string>();
  setHandler(callUpdate, ({ callId, event }) => {
    answered.add(callId);
    if (event === 'ended') ended.add(callId);
  });
  const plan = await db.followUpPlan(input);
  const placed = await db.placeFollowUpCall(input);
  if (!placed.done) {
    const picked = await condition(() => answered.has(input.callId), plan.ringTimeoutMs);
    if (picked) await condition(() => ended.has(input.callId), plan.talkTimeoutMs);
    if (!ended.has(input.callId)) await db.endFollowUpCall(input);
  }
  await db.finishFollowUp(input);
  return { failed: !!placed.failed };
}

/**
 * A scheduled job's time came round: start its run. One run per tick: a
 * retried start finds the tick's run already there and starts nothing.
 */
export async function jobScheduleWorkflow(input: JobScheduleInput) {
  return db.startScheduledJob(input);
}

/**
 * The company's list and record sweep (every 10 minutes while a list or record
 * job is on): each due item and each changed record starts one run.
 */
export async function jobSweepWorkflow(input: JobSweepInput) {
  return db.sweepJobs(input);
}
