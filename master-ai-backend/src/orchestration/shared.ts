/**
 * Types and names shared by workflow code and the API. This file must stay
 * free of Node imports: Temporal bundles it into the deterministic workflow
 * sandbox.
 */

import type { StageKey } from '@onehuman/schemas';

export const SIGNALS = {
  planDecision: 'planDecision',
  approvalDecision: 'approvalDecision',
  pause: 'pause',
  resume: 'resume',
  callUpdate: 'callUpdate',
  gateDecision: 'gateDecision',
  infoAdded: 'infoAdded',
  cancelCase: 'cancelCase',
} as const;

export interface GoalWorkflowInput {
  tenantId: string;
  goalId: string;
  /** Skip the owner's plan review. */
  autoStart?: boolean;
}

export interface TaskWorkflowInput {
  tenantId: string;
  goalId: string;
  taskId: string;
}

export interface PlanDecisionSignal {
  approved: boolean;
  notes?: string;
}

export interface ApprovalDecisionSignal {
  approvalId: string;
  decision: 'approved' | 'rejected' | 'edited';
}

export type TaskOutcome = 'completed' | 'escalated' | 'failed' | 'skipped' | 'cancelled';

export interface PlannedTaskRef {
  id: string;
  key: string;
  dependsOn: string[];
}

export type AgentStepResult =
  | { kind: 'tool'; toolCallId: string }
  | { kind: 'finish'; output: { summary: string; data?: unknown } }
  | { kind: 'invalid'; reason: string }
  | { kind: 'stop'; reason: string };

export interface ActionDecisionResult {
  level: 1 | 2 | 3 | 4 | 5;
  /** The action hands work to a team member (runs the call cadence). */
  delegate: boolean;
}

export interface DelegationWorkflowInput {
  tenantId: string;
  delegationId: string;
}

export interface CallUpdateSignal {
  callId: string;
  event: 'answered' | 'ended';
}

export type CallStageName = 'assign' | 'follow_up' | 'confirm';

export interface RoutineRunInput {
  tenantId: string;
  routineId: string;
  /** schedule: the routine's time came round. manual: "Run now". */
  trigger: 'schedule' | 'manual';
}

export interface FollowUpSweepInput {
  tenantId: string;
  /** schedule: the half-hourly sweep. manual: "Call now". */
  trigger: 'schedule' | 'manual';
}

export interface FollowUpCallInput {
  tenantId: string;
  callId: string;
}

export interface CheckinCallInput {
  tenantId: string;
  entryId: string;
}


export interface ApprovalCreated {
  approvalId: string;
  ttlMs: number;
}

/** A person approved or rejected a case gate (stage 5 approval or stage 7 sign-off). */
export interface GateDecisionSignal {
  approvalId: string;
  decision: 'approved' | 'rejected';
  notes?: string;
}

export interface CaseWorkflowInput {
  tenantId: string;
  caseId: string;
}

export interface StageWorkflowInput {
  tenantId: string;
  caseId: string;
  stage: StageKey;
  attempt: number;
  /** Execute, attempt 2: why the first result was not accepted. */
  reworkNote?: string;
}

export interface CancelCaseSignal {
  reason?: string;
}

export const caseWorkflowId = (caseId: string) => `case-${caseId}`;
export const stageWorkflowId = (caseId: string, stage: string, attempt: number) => `case-${caseId}-${stage}-${attempt}`;

/** How a case ends. Each has a matching case status. */
export type CaseEnding = 'closed' | 'rejected' | 'cancelled' | 'escalated';

export type GateName = 'proceed' | 'close';

/** What a stage activity tells its workflow. */
export type StageRunResult = { outcome: 'done' } | { outcome: 'needs_info'; waitMs: number } | { outcome: 'not_eligible'; reason: string };

/** What opening a gate found: nothing to approve, not allowed, or an approval to wait for. */
export type GateOpened =
  | { status: 'not_required' }
  | { status: 'blocked'; reason: string }
  | { status: 'waiting'; approvalId: string; ttlMs: number }
  /** A kill switch is on: hold and ask again after resume. */
  | { status: 'paused' };
