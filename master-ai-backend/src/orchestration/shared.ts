/**
 * Types and names shared by workflow code and the API. This file must stay
 * free of Node imports: Temporal bundles it into the deterministic workflow
 * sandbox.
 */

export const SIGNALS = {
  planDecision: 'planDecision',
  approvalDecision: 'approvalDecision',
  pause: 'pause',
  resume: 'resume',
  callUpdate: 'callUpdate',
  gateDecision: 'gateDecision',
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
