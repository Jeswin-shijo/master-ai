import type { INestApplicationContext } from '@nestjs/common';
import type { DelegationStatus } from '@onehuman/schemas';
import { DelegationService, type CallResult, type DelegationResult } from '../voice/delegation.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { OrchestratorService } from './orchestrator.service';
import type { CallStageName, DelegationWorkflowInput, GoalWorkflowInput, TaskOutcome, TaskWorkflowInput } from './shared';
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
  };
}

export type Activities = ReturnType<typeof createActivities>;
