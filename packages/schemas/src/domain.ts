import type { AgentClearance, AutonomyLevel, DataClass, ModelTier } from './autonomy';
import type { PackAgent, ResolvedPack } from './pack';

/** Response shapes returned by the API. Dates are ISO strings on the wire. */

export type PrincipalKind = 'human' | 'agent';
export type HumanRole = 'owner' | 'admin' | 'member';
export type RunStatus = 'active' | 'paused';

export interface SessionUser {
  userId: string;
  principalId: string;
  tenantId: string;
  name: string;
  email: string;
  role: HumanRole;
}

export interface AuthResponse {
  token: string;
  user: SessionUser;
  tenant: TenantSummary;
}

export interface TenantSummary {
  id: string;
  name: string;
  industry: string;
  status: RunStatus;
  onboarded: boolean;
  settings: TenantSettings;
}

export interface TenantSettings {
  brandColor?: string;
  redactPii: boolean;
  /** Risk score bands → action level (score below `level1Below` is Level 1, ...). */
  riskBands: { level1Below: number; level2Below: number; level3Below: number };
  /** Hours an approval waits before it expires and the task escalates. */
  approvalTtlHours: number;
  calls: CallSettings;
}

/** How phone calls to staff are placed. */
export interface CallSettings {
  /** `simulator` until a telephony provider (Exotel, Plivo, Twilio) is connected. */
  provider: 'simulator';
  /** `interactive`: calls ring in the web app and a person answers as the staff member. `auto`: a simulated staff member answers. */
  simulatorMode: 'auto' | 'interactive';
  /** Compress the follow-up/confirm schedule to seconds (simulation and demos). */
  fastSchedule: boolean;
  /** Attempts per call before the person counts as unreachable. */
  maxAttempts: number;
  /** Minutes between attempts when nobody answers. */
  retryMinutes: number;
}

export interface PackDraft {
  id: string;
  industry: string;
  source: 'registry' | 'generated';
  /** How the pack was chosen, e.g. "matched registry pack travel-agency (score 0.82)". */
  rationale: string;
  generator: 'registry' | 'llm' | 'offline-template';
  pack: ResolvedPack;
  status: 'draft' | 'installed' | 'discarded';
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  packId: string;
  packVersion: string;
  status: RunStatus;
  pack: ResolvedPack;
  createdAt: string;
}

export interface AgentView {
  id: string;
  workspaceId: string;
  role: string;
  name: string;
  description: string;
  status: RunStatus | 'retired';
  autonomy: AgentClearance;
  tools: string[];
  spec: PackAgent;
  model: { tier: ModelTier; fallback?: ModelTier; dataClass: DataClass };
  stats: { tasksCompleted: number; approvalsRequested: number; approvalsRejected: number; spendInr: number };
  overrides: AutonomyOverride[];
}

export interface AutonomyOverride {
  id: string;
  tool: string;
  level: 1 | 2 | 3;
  createdAt: string;
}

export interface AutonomySuggestion {
  agentId: string;
  tool: string;
  consecutiveCleanApprovals: number;
  suggestedLevel: 3;
}

export type GoalStatus =
  | 'planning'
  | 'awaiting_plan_approval'
  | 'running'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'cancelled';

export interface PlannedTask {
  key: string;
  title: string;
  description: string;
  agentRole: string;
  dependsOn: string[];
}

export interface Goal {
  id: string;
  workspaceId: string;
  text: string;
  status: GoalStatus;
  plan: { tasks: PlannedTask[]; rationale: string; workflowId?: string } | null;
  summary: string | null;
  tokens: number;
  costInr: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'waiting_on_team'
  | 'paused'
  | 'completed'
  | 'escalated'
  | 'failed'
  | 'skipped';

export interface Task {
  id: string;
  goalId: string;
  key: string;
  title: string;
  description: string;
  agentId: string;
  agentRole: string;
  agentName: string;
  dependsOn: string[];
  status: TaskStatus;
  waitingOn: string | null;
  output: { summary: string; data?: unknown } | null;
  steps: number;
  tokens: number;
  costInr: number;
  startedAt: string | null;
  completedAt: string | null;
}

export type ToolCallStatus =
  | 'proposed'
  | 'running'
  | 'executed'
  | 'awaiting_approval'
  | 'blocked'
  | 'rejected'
  | 'failed'
  | 'expired';

export interface RiskFactor {
  factor: string;
  points: number;
  detail: string;
}

export interface PolicyDecision {
  level: AutonomyLevel;
  riskScore: number;
  factors: RiskFactor[];
  reasons: string[];
  approver: string | null;
  policyVersion: number;
}

export interface ToolCall {
  id: string;
  taskId: string;
  agentId: string;
  tool: string;
  args: Record<string, unknown>;
  rationale: string;
  status: ToolCallStatus;
  decision: PolicyDecision | null;
  result: unknown;
  error: string | null;
  createdAt: string;
  executedAt: string | null;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'edited' | 'expired';

export interface ApprovalRequest {
  id: string;
  goalId: string;
  taskId: string;
  toolCallId: string;
  agentId: string;
  agentName: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  rationale: string;
  riskScore: number;
  factors: RiskFactor[];
  reasons: string[];
  evidence: { label: string; value: string }[];
  costSoFarInr: number;
  approver: string;
  status: ApprovalStatus;
  expiresAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
  editedArgs: Record<string, unknown> | null;
  signature: string | null;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  seq: number;
  type: string;
  actorId: string | null;
  actorKind: PrincipalKind | 'system';
  goalId: string | null;
  taskId: string | null;
  refId: string | null;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
  createdAt: string;
}

export interface AuditVerifyResult {
  ok: boolean;
  checked: number;
  headSeq: number;
  headHash: string;
  firstBrokenSeq: number | null;
}

export interface PackRecord {
  id: string;
  entity: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  chunks: number;
  createdAt: string;
}

export interface OutboxItem {
  id: string;
  kind: 'message' | 'payment_request' | 'refund' | 'schedule' | 'document';
  status: 'draft' | 'simulated';
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Pulse {
  generatedAt: string;
  headline: string;
  lines: string[];
  pendingApprovals: number;
  runningTasks: number;
  completedToday: number;
  blockedToday: number;
  spendTodayInr: number;
}

export interface KpiValue {
  id: string;
  name: string;
  unit: string;
  direction: 'up' | 'down';
  target?: number;
  value: number | null;
  /** Why the value is null, e.g. "needs a data connector". */
  note?: string;
}

export interface OpsOverview {
  pulse: Pulse;
  kpis: KpiValue[];
}

export interface DeviceKey {
  id: string;
  label: string;
  platform: 'web' | 'ios' | 'android';
  createdAt: string;
}

export interface WorkingHours {
  days: number[];
  start: string;
  end: string;
}

/** A person in charge: company staff the AI delegates work to by phone. */
export interface StaffMember {
  id: string;
  name: string;
  phone: string;
  title: string;
  responsibilities: string[];
  workingHours: WorkingHours;
  language: 'en';
  status: 'active' | 'inactive';
  stats: { calls: number; openDelegations: number; done: number };
  createdAt: string;
}

export type CallStage = 'assign' | 'follow_up' | 'confirm';

export type CallStatus = 'scheduled' | 'ringing' | 'in_progress' | 'completed' | 'no_answer' | 'failed' | 'cancelled';

/** What the call established, extracted from the conversation. */
export type CallOutcome =
  | 'accepted'
  | 'declined'
  | 'on_track'
  | 'blocked'
  | 'needs_more_time'
  | 'done'
  | 'not_done'
  | 'no_answer'
  | 'unclear';

export interface TranscriptLine {
  speaker: 'ai' | 'person';
  text: string;
  at: string;
}

export interface CallRecord {
  id: string;
  delegationId: string;
  staffId: string;
  staffName: string;
  staffTitle: string;
  stage: CallStage;
  attempt: number;
  status: CallStatus;
  provider: string;
  scheduledFor: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  transcript: TranscriptLine[];
  summary: string | null;
  outcome: CallOutcome | null;
  extracted: { dueAt?: string | null; notes?: string | null };
  delegationTitle: string;
  createdAt: string;
}

export type DelegationStatus =
  | 'assigning'
  | 'accepted'
  | 'in_progress'
  | 'done'
  | 'declined'
  | 'blocked'
  | 'not_done'
  | 'unreachable'
  | 'cancelled';

/** A piece of work handed to a person in charge and tracked through 2–3 calls. */
export interface Delegation {
  id: string;
  goalId: string;
  taskId: string;
  toolCallId: string;
  staffId: string;
  staffName: string;
  staffTitle: string;
  title: string;
  instructions: string;
  dueAt: string | null;
  status: DelegationStatus;
  stage: CallStage | 'closed';
  nextCallAt: string | null;
  outcome: { summary: string; notes?: string | null } | null;
  calls: CallRecord[];
  createdAt: string;
  completedAt: string | null;
}
