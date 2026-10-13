import type { INestApplicationContext } from '@nestjs/common';
import type { DelegationStatus } from '@onehuman/schemas';
import { CaseStagesService } from '../cases/stages.service';
import { RoutinesService } from '../routines/routines.service';
import { DelegationService, type CallResult, type DelegationResult } from '../voice/delegation.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { OrchestratorService } from './orchestrator.service';
import type {
  CaseEnding,
  GateName,
  StageWorkflowInput,
  CallStageName,
  CheckinCallInput,
  DelegationWorkflowInput,
  GoalWorkflowInput,
  RoutineRunInput,
  TaskOutcome,
  TaskWorkflowInput,
} from './shared';
import { TaskLifecycleService } from './task-lifecycle.service';

/**
 * Temporal activities: the only place workflow code touches the outside world
 * (database, models, connectors). Each is retried by Temporal on failure.
 */
export function createActivities(app: INestApplicationContext) {
  const orchestrator = app.get(OrchestratorService);
  const runtime = app.get(AgentRuntimeService);
  const lifecycle = app.get(TaskLifecycleService);
  const delegation = app.get(DelegationService);
  const routines = app.get(RoutinesService);
  const stages = app.get(CaseStagesService);

  return {
    planGoal: (i: GoalWorkflowInput) => orchestrator.planGoal(i.tenantId, i.goalId, !!i.autoStart),
    markGoalRunning: (i: GoalWorkflowInput & { approved: boolean; notes?: string }) =>
      orchestrator.markGoalRunning(i.tenantId, i.goalId, null, i.approved, i.notes),
    finishGoal: (i: GoalWorkflowInput & { outcomes: Record<string, TaskOutcome>; cancelledReason?: string }) =>
      orchestrator.finishGoal(i.tenantId, i.goalId, i.outcomes, i.cancelledReason),

    startTask: (i: TaskWorkflowInput) => lifecycle.startTask(i.tenantId, i.taskId),
    setTaskPaused: (i: TaskWorkflowInput & { paused: boolean }) => lifecycle.setTaskPaused(i.tenantId, i.taskId, i.paused),
    agentStep: (i: TaskWorkflowInput) => runtime.step(i.tenantId, i.taskId),
    evaluateAction: (i: TaskWorkflowInput & { toolCallId: string }) => lifecycle.evaluateAction(i.tenantId, i.taskId, i.toolCallId),
    executeAction: (i: TaskWorkflowInput & { toolCallId: string; approvalId?: string }) =>
      lifecycle.executeAction(i.tenantId, i.taskId, i.toolCallId, i.approvalId),
    requestApproval: (i: TaskWorkflowInput & { toolCallId: string }) => lifecycle.requestApproval(i.tenantId, i.taskId, i.toolCallId),
    resumeAfterApproval: (i: TaskWorkflowInput) => lifecycle.resumeAfterApproval(i.tenantId, i.taskId),
    expireApproval: (i: TaskWorkflowInput & { approvalId: string }) => lifecycle.expireApproval(i.tenantId, i.taskId, i.approvalId),
    qualityCheck: (i: TaskWorkflowInput & { output: { summary: string } }) => runtime.qualityCheck(i.tenantId, i.taskId, i.output),
    completeTask: (i: TaskWorkflowInput & { output: { summary: string; data?: unknown } }) =>
      lifecycle.completeTask(i.tenantId, i.taskId, i.output),
    escalateTask: (i: TaskWorkflowInput & { reason: string }) => lifecycle.escalateTask(i.tenantId, i.taskId, i.reason),
    skipTask: (i: TaskWorkflowInput & { reason: string }) => lifecycle.skipTask(i.tenantId, i.taskId, i.reason),

    // Delegation by phone
    startDelegation: (i: TaskWorkflowInput & { toolCallId: string }) => delegation.start(i.tenantId, i.taskId, i.toolCallId),
    finishDelegationAction: (i: TaskWorkflowInput & { toolCallId: string; result: DelegationResult }) =>
      delegation.finishAction(i.tenantId, i.taskId, i.toolCallId, i.result),
    delegationPlan: (i: DelegationWorkflowInput) => delegation.plan(i.tenantId),
    waitBeforeCall: (i: DelegationWorkflowInput) => delegation.waitBeforeCall(i.tenantId, i.delegationId),
    placeCall: (i: DelegationWorkflowInput & { stage: CallStageName; attempt: number }) =>
      delegation.placeCall(i.tenantId, i.delegationId, i.stage, i.attempt),
    callResult: (i: DelegationWorkflowInput & { callId: string }) => delegation.callResult(i.tenantId, i.callId),
    markNoAnswer: (i: DelegationWorkflowInput & { callId: string }) => delegation.markNoAnswer(i.tenantId, i.callId),
    scheduleNextCall: (i: DelegationWorkflowInput & { stage: 'follow_up' | 'confirm' }) =>
      delegation.scheduleNext(i.tenantId, i.delegationId, i.stage),
    applyCallOutcome: (i: DelegationWorkflowInput & { result: CallResult }) => delegation.applyOutcome(i.tenantId, i.delegationId, i.result),
    closeDelegation: (i: DelegationWorkflowInput & { status: DelegationStatus; result: CallResult | null }) =>
      delegation.close(i.tenantId, i.delegationId, i.status, i.result),

    // Routines: check-ins collected by phone
    startRoutineRun: (i: RoutineRunInput) => routines.startRun(i.tenantId, i.routineId, i.trigger),
    finishRoutineRun: (i: RoutineRunInput) => routines.finishRun(i.tenantId, i.routineId),
    checkinPlan: (i: CheckinCallInput) => routines.plan(i.tenantId),
    checkinWait: (i: CheckinCallInput) => routines.waitBeforeCall(i.tenantId, i.entryId),
    placeCheckinCall: (i: CheckinCallInput & { attempt: number }) => routines.placeCall(i.tenantId, i.entryId, i.attempt),
    checkinResult: (i: CheckinCallInput & { callId: string | null }) => routines.callResult(i.tenantId, i.entryId, i.callId),
    endCheckinCall: (i: CheckinCallInput & { callId: string }) => routines.endUnanswered(i.tenantId, i.callId),
    markCheckinMissed: (i: CheckinCallInput) => routines.markMissed(i.tenantId, i.entryId),

    // Cases: one activity per piece of stage work
    beginStage: (i: StageWorkflowInput) => stages.beginStage(i),
    isPaused: (i: StageWorkflowInput) => stages.isPaused(i),
    runStage: (i: StageWorkflowInput) => stages.runStage(i),
    completeStage: (i: StageWorkflowInput & { status: 'done' | 'skipped' | 'failed'; summary?: string }) => stages.completeStage(i),
    openGate: (i: StageWorkflowInput & { gate: GateName }) => stages.openGate(i),
    closeGate: (i: StageWorkflowInput & { gate: GateName; approvalId: string; decision: 'approved' | 'rejected' | 'expired'; notes?: string }) =>
      stages.closeGate(i),
    startExecution: (i: StageWorkflowInput) => stages.startExecution(i),
    finishExecution: (i: StageWorkflowInput & { goalId: string }) => stages.finishExecution(i),
    cancelExecution: (i: StageWorkflowInput & { goalId: string }) => stages.cancelExecution(i),
    verifyClose: (i: StageWorkflowInput) => stages.verifyClose(i),
    finishCase: (i: { tenantId: string; caseId: string; ending: CaseEnding; reason: string | null }) => stages.finishCase(i),
  };
}

export type Activities = ReturnType<typeof createActivities>;
