import type { AgentClearance, AutonomyLevel, DataClass, ModelTier } from './autonomy';
import type { CaseFile, Requester } from './case';
import type { CaseLabel, CaseRisk, CaseSource, PriorityId, SectorId, StageKey } from './lifecycle';
import type { PackAgent, ResolvedPack, RoutineQuestion } from './pack';

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
  /** Lifecycle roles this person approves for, e.g. safety-officer. */
  approverRoles: string[];
}

export interface AuthResponse {
  token: string;
  user: SessionUser;
  tenant: TenantSummary;
  /** Every company this login belongs to, to switch between them. */
  companies: Company[];
}

export interface Company {
  id: string;
  name: string;
  role: HumanRole;
}

export interface TenantSummary {
  id: string;
  name: string;
  industry: string;
  /** Chosen at signup; null for companies created before sectors existed. */
  sector: SectorId | null;
  /** The ready-made organization type (its pack id), or null when the owner typed their own. */
  orgType: string | null;
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
  /** Days a case waits for missing details before it is cancelled. */
  needsInfoDays: number;
  calls: CallSettings;
}

export type CallProvider = 'simulator' | 'twilio';

/** Whether real calls can be placed from this server, and what is missing if not. */
export interface VoiceStatus {
  twilio: { configured: boolean; missing: string[]; from: string | null; publicUrl: string | null };
}

/** How phone calls to staff are placed. */
export interface CallSettings {
  /** `simulator` rings in the web app; `twilio` places real phone calls. */
  provider: CallProvider;
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
  /** The case whose work this is (stage 6), if any. Its `text` is then written for the agents, so people see the case instead. */
  caseId: string | null;
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
  /** The step in plain words for the owner. Present on goal details. */
  narrative?: StepNarrative;
}

/** One agent step told in plain language, e.g. "Marked Priya Sharma's enquiry as contacted". */
export interface StepNarrative {
  /** A full sentence. */
  text: string;
  /** Two or three words for small labels, e.g. "Mark contacted". */
  short: string;
  /** Supporting lines: records found, the message that was sent. */
  items?: string[];
  tone: 'done' | 'info' | 'pending' | 'problem';
}

/** What a goal achieved, in words a client understands. */
export interface GoalReport {
  goalId: string;
  text: string;
  status: GoalStatus;
  createdAt: string;
  completedAt: string | null;
  /** Things that were done, one sentence each. */
  done: string[];
  /** Waiting on approval or on the team. */
  pending: string[];
  /** Things that failed, were refused or need the owner. */
  attention: string[];
  /** Team members phoned, and the owner's own decisions. */
  people: string[];
  counts: { actions: number; messages: number; recordsChanged: number; calls: number; approvals: number };
  costInr: number;
}

export type ReportPeriod = 'today' | 'week' | 'month' | 'all';

export interface WorkReport {
  period: ReportPeriod;
  from: string | null;
  to: string;
  totals: { goals: number; cases: number; finished: number; needYou: number; actions: number; messages: number; calls: number; costInr: number };
  goals: GoalReport[];
  cases: CaseReport[];
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'edited' | 'expired';

export type ApprovalKind = 'action' | 'case_gate';

export interface ApprovalRequest {
  id: string;
  /** `action`: an agent's step inside a goal. `case_gate`: a case's approval (stage 5) or sign-off (stage 7). */
  kind: ApprovalKind;
  goalId: string | null;
  taskId: string | null;
  toolCallId: string | null;
  caseId: string | null;
  stage: StageKey | null;
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
  source: 'owner' | 'pack';
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

/** Delegation calls assign, follow up and confirm; check-in calls collect a routine's answers. */
export type CallStage = 'assign' | 'follow_up' | 'confirm' | 'checkin';

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
  | 'unclear'
  /** Check-in calls: every required answer was collected. */
  | 'reported'
  /** Check-in calls: the person asked to be called back. */
  | 'call_back';

export interface TranscriptLine {
  speaker: 'ai' | 'person';
  text: string;
  at: string;
}

export interface CallRecord {
  id: string;
  /** Set for calls about delegated work. */
  delegationId: string | null;
  /** Set for routine check-in calls. */
  checkinId: string | null;
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
  extracted: { dueAt?: string | null; notes?: string | null; values?: Record<string, CheckinValue> };
  /** What the call is about: the delegated job, or the routine's name. */
  delegationTitle: string;
  /** Likely replies for the simulator, e.g. for the question being asked. */
  suggestions?: string[];
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

// ---------- Routines: repeating check-ins, by hand or by phone ----------

export type RoutineMode = 'manual' | 'automatic';

/** A repeating check-in the business runs, e.g. the daily site report. */
export interface Routine {
  id: string;
  templateId: string | null;
  name: string;
  description: string;
  /** automatic: the AI phones everyone at `time`. manual: people fill it in by `time`. */
  mode: RoutineMode;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** HH:MM, India time. */
  time: string;
  /** Manual mode: phone whoever has not reported by `time`. */
  chaseMissing: boolean;
  questions: RoutineQuestion[];
  people: { id: string; name: string; title: string }[];
  status: 'active' | 'paused';
  /** The next time it runs, when active. */
  nextRunAt: string | null;
  today: RoutineDaySummary;
  /** Each reporter's state today, by staff id. */
  todayStatus: Record<string, CheckinStatus>;
  createdAt: string;
  updatedAt: string;
}

export type CheckinStatus = 'pending' | 'calling' | 'reported' | 'missed';
export type CheckinValue = string | number | boolean | null;

/** One person's answers for one day. */
export interface CheckinEntry {
  id: string;
  routineId: string;
  staffId: string;
  staffName: string;
  staffTitle: string;
  /** YYYY-MM-DD, India time. */
  date: string;
  status: CheckinStatus;
  source: 'manual' | 'call' | null;
  values: Record<string, CheckinValue>;
  /** Problems raised in the answers, in plain words. */
  flags: string[];
  /** Calls made for this entry, newest last. */
  calls: CallRecord[];
  updatedAt: string;
}

export interface RoutineDaySummary {
  date: string;
  expected: number;
  reported: number;
  calling: number;
  missed: number;
  pending: number;
  /** "Ravi Kumar: cement is running low" */
  flags: string[];
  /** Number questions summed (workers) and percents averaged (progress). */
  totals: { key: string; label: string; value: number; unit?: string }[];
}

export interface RoutineDay {
  routine: Routine;
  date: string;
  entries: CheckinEntry[];
  summary: RoutineDaySummary;
  /** Earlier days, newest first. */
  history: RoutineDaySummary[];
}

export type CaseStatus =
  | 'open'
  | 'needs_info'
  | 'waiting_approval'
  | 'in_progress'
  | 'waiting_signoff'
  | 'closed'
  | 'rejected'
  | 'cancelled'
  | 'escalated';

export type CaseStageStatus = 'pending' | 'running' | 'needs_info' | 'waiting_approval' | 'done' | 'skipped' | 'failed';

export interface CaseAssignee {
  staffId?: string;
  name: string;
  title?: string;
}

/** A request moving through the 8 stages. */
export interface Case {
  id: string;
  workspaceId: string;
  number: number;
  /** As people see it, e.g. WO-0042. */
  code: string;
  title: string;
  source: CaseSource;
  requester: Requester;
  category: string | null;
  categoryName: string | null;
  priority: PriorityId | null;
  risk: CaseRisk | null;
  department: string | null;
  amountInr: number | null;
  assignee: CaseAssignee | null;
  respondBy: string | null;
  resolveBy: string | null;
  stage: StageKey;
  status: CaseStatus;
  /** One plain sentence once the case ends. */
  outcome: string | null;
  goalId: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

/** One attempt at one stage. */
export interface CaseStage {
  stage: StageKey;
  attempt: number;
  /** As the organization names it, e.g. "Permit & Isolation Approval". */
  name: string;
  status: CaseStageStatus;
  /** One plain sentence for people. */
  summary: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

/** What a case achieved, in words a client understands. */
export interface CaseReport {
  caseId: string;
  code: string;
  title: string;
  status: CaseStatus;
  outcome: string | null;
  /** The stage-8 report, or a line saying where the case is. */
  text: string;
  slaMet: boolean | null;
  recurring: { count: number; note: string } | null;
  stages: { stage: StageKey; name: string; status: CaseStageStatus; minutes: number | null; summary: string | null }[];
  /** What the stage-6 work did. */
  work: GoalReport | null;
  createdAt: string;
  closedAt: string | null;
}

export interface CaseDetail {
  case: Case;
  /** This organization's word for a case, e.g. Work order / Work orders / WO. */
  label: CaseLabel;
  /** Each stage's findings. The apps show them in words, never as JSON. */
  file: CaseFile;
  stages: CaseStage[];
  approvals: ApprovalRequest[];
  report: CaseReport;
}

export interface IntakeKey {
  id: string;
  kind: 'form' | 'api';
  source: 'customer' | 'system' | 'partner';
  label: string;
  /** The first characters of the key, to tell keys apart. */
  hint: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Returned once, when the key is made. */
export interface CreatedIntakeKey extends IntakeKey {
  key: string;
  /** Form keys: the public form's path, `/r/<tenantId>/<key>`. */
  formPath: string | null;
}

/** What the public request form shows above its fields. */
export interface PublicForm {
  companyName: string;
  /** e.g. "Service request". */
  caseLabel: string;
}

/** A person with a login in this company. */
export interface Member {
  id: string;
  name: string;
  email: string;
  role: HumanRole;
  approverRoles: string[];
  status: 'active' | 'paused' | 'retired';
  /** The team-directory record this person also answers calls as, if linked. */
  staffId: string | null;
  createdAt: string;
}

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface Invite {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  approverRoles: string[];
  status: InviteStatus;
  expiresAt: string;
  createdAt: string;
}

/** Returned once, when the invite is made. */
export interface CreatedInvite extends Invite {
  /** `/invite/<tenantId>/<token>`. */
  path: string;
  /** The full link on the web app, for the owner to send. */
  link: string;
}

/** What the invite page shows before the person joins. */
export interface InviteView {
  companyName: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  approverRoles: { id: string; name: string }[];
  /** The email already has a login: sign in instead of choosing a password. */
  hasAccount: boolean;
  expiresAt: string;
}
