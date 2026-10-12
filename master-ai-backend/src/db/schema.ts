import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import type {
  CallOutcome,
  CallStage,
  CallStatus,
  CheckinStatus,
  CheckinValue,
  DelegationStatus,
  PackAgent,
  PlannedTask,
  PolicyDecision,
  PolicyRule,
  ResolvedPack,
  RoutineQuestion,
  TenantSettings,
  TranscriptLine,
  WorkingHours,
} from '@onehuman/schemas';

/**
 * System of record. Every tenant-owned table carries tenant_id and is protected
 * by row-level security (see drizzle/0001_rls.sql): the app role only ever
 * sees rows for the tenant set on the current transaction.
 */

const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const id = () => uuid('id').primaryKey().defaultRandom();
const tenantId = () => uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 14, scale: 4, mode: 'number' }).notNull().default(0);

/** Global identity (no tenant): one login can belong to several companies. */
export const users = pgTable('users', {
  id: id(),
  email: citext('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
});

export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  industry: text('industry').notNull(),
  status: text('status', { enum: ['active', 'paused'] }).notNull().default('active'),
  onboarded: boolean('onboarded').notNull().default(false),
  settings: jsonb('settings').$type<TenantSettings>().notNull(),
  createdAt: createdAt(),
});

/** A human user or an agent identity inside a tenant. */
export const principals = pgTable(
  'principals',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind', { enum: ['human', 'agent'] }).notNull(),
    userId: uuid('user_id').references(() => users.id),
    displayName: text('display_name').notNull(),
    role: text('role').notNull(),
    status: text('status', { enum: ['active', 'paused', 'retired'] }).notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [index('principals_tenant_idx').on(t.tenantId), index('principals_user_idx').on(t.userId)],
);

/** An Industry Pack installed in a tenant. The resolved pack is snapshotted. */
export const workspaces = pgTable('workspaces', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  packId: text('pack_id').notNull(),
  packVersion: text('pack_version').notNull(),
  status: text('status', { enum: ['active', 'paused'] }).notNull().default('active'),
  pack: jsonb('pack').$type<ResolvedPack>().notNull(),
  createdAt: createdAt(),
});

export const packDrafts = pgTable('pack_drafts', {
  id: id(),
  tenantId: tenantId(),
  industry: text('industry').notNull(),
  source: text('source', { enum: ['registry', 'generated'] }).notNull(),
  generator: text('generator', { enum: ['registry', 'llm', 'offline-template'] }).notNull(),
  rationale: text('rationale').notNull(),
  pack: jsonb('pack').$type<ResolvedPack>().notNull(),
  status: text('status', { enum: ['draft', 'installed', 'discarded'] }).notNull().default('draft'),
  createdAt: createdAt(),
});

/** Agent spec + runtime state. `id` is the agent's principal id. */
export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().references(() => principals.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: ['active', 'paused', 'retired'] }).notNull().default('active'),
    autonomy: integer('autonomy').notNull(),
    spec: jsonb('spec').$type<PackAgent>().notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('agents_workspace_role_idx').on(t.workspaceId, t.role)],
);

/** Earned autonomy: owner-approved lower level for one agent + tool. */
export const autonomyOverrides = pgTable(
  'autonomy_overrides',
  {
    id: id(),
    tenantId: tenantId(),
    agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
    tool: text('tool').notNull(),
    level: integer('level').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('autonomy_overrides_agent_tool_idx').on(t.agentId, t.tool)],
);

/** Versioned policy set per workspace. */
export const policies = pgTable(
  'policies',
  {
    id: id(),
    tenantId: tenantId(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    packRules: jsonb('pack_rules').$type<PolicyRule[]>().notNull(),
    tenantRules: jsonb('tenant_rules').$type<PolicyRule[]>().notNull().default([]),
    cedar: text('cedar').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('policies_workspace_version_idx').on(t.workspaceId, t.version)],
);

export const goals = pgTable(
  'goals',
  {
    id: id(),
    tenantId: tenantId(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by'),
    text: text('text').notNull(),
    origin: text('origin', { enum: ['owner', 'inbound'] }).notNull().default('owner'),
    status: text('status').notNull().default('planning'),
    plan: jsonb('plan').$type<{ tasks: PlannedTask[]; rationale: string; workflowId?: string }>(),
    summary: text('summary'),
    workflowId: text('workflow_id'),
    tokens: integer('tokens').notNull().default(0),
    costInr: money('cost_inr'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('goals_tenant_created_idx').on(t.tenantId, t.createdAt)],
);

export interface TaskFeedback {
  at: string;
  source: 'approval' | 'quality' | 'validation' | 'policy' | 'tool' | 'model';
  text: string;
}

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    tenantId: tenantId(),
    goalId: uuid('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    agentId: uuid('agent_id').notNull().references(() => agents.id),
    dependsOn: text('depends_on').array().notNull().default(sql`'{}'::text[]`),
    status: text('status').notNull().default('pending'),
    waitingOn: text('waiting_on'),
    output: jsonb('output').$type<{ summary: string; data?: unknown }>(),
    feedback: jsonb('feedback').$type<TaskFeedback[]>().notNull().default([]),
    steps: integer('steps').notNull().default(0),
    tokens: integer('tokens').notNull().default(0),
    costInr: money('cost_inr'),
    moneySpentInr: money('money_spent_inr'),
    workflowId: text('workflow_id'),
    createdAt: createdAt(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('tasks_goal_idx').on(t.goalId), index('tasks_status_idx').on(t.tenantId, t.status)],
);

export const toolCalls = pgTable(
  'tool_calls',
  {
    id: id(),
    tenantId: tenantId(),
    goalId: uuid('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').notNull().references(() => agents.id),
    tool: text('tool').notNull(),
    args: jsonb('args').$type<Record<string, unknown>>().notNull(),
    rationale: text('rationale').notNull().default(''),
    status: text('status').notNull().default('proposed'),
    decision: jsonb('decision').$type<PolicyDecision>(),
    result: jsonb('result'),
    error: text('error'),
    createdAt: createdAt(),
    executedAt: timestamp('executed_at', { withTimezone: true }),
  },
  (t) => [index('tool_calls_task_idx').on(t.taskId, t.createdAt)],
);

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: id(),
    tenantId: tenantId(),
    goalId: uuid('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    toolCallId: uuid('tool_call_id').notNull().unique().references(() => toolCalls.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').notNull().references(() => agents.id),
    tool: text('tool').notNull(),
    args: jsonb('args').$type<Record<string, unknown>>().notNull(),
    summary: text('summary').notNull(),
    rationale: text('rationale').notNull(),
    decision: jsonb('decision').$type<PolicyDecision>().notNull(),
    evidence: jsonb('evidence').$type<{ label: string; value: string }[]>().notNull(),
    costSoFarInr: money('cost_so_far_inr'),
    approver: text('approver').notNull().default('owner'),
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'edited', 'expired'] })
      .notNull()
      .default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNotes: text('decision_notes'),
    editedArgs: jsonb('edited_args').$type<Record<string, unknown>>(),
    signature: text('signature'),
    signingKeyId: uuid('signing_key_id'),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('approvals_status_idx').on(t.tenantId, t.status, t.createdAt)],
);

export const deviceKeys = pgTable('device_keys', {
  id: id(),
  tenantId: tenantId(),
  principalId: uuid('principal_id').notNull().references(() => principals.id, { onDelete: 'cascade' }),
  publicKey: text('public_key').notNull(),
  label: text('label').notNull(),
  platform: text('platform', { enum: ['web', 'ios', 'android'] }).notNull(),
  createdAt: createdAt(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const pushTokens = pgTable('push_tokens', {
  id: id(),
  tenantId: tenantId(),
  principalId: uuid('principal_id').notNull().references(() => principals.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  platform: text('platform', { enum: ['ios', 'android'] }).notNull(),
  createdAt: createdAt(),
});

/** Sector entities from the pack, validated by the pack's schema before insert. */
export const records = pgTable(
  'records',
  {
    id: id(),
    tenantId: tenantId(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('records_entity_idx').on(t.tenantId, t.workspaceId, t.entity)],
);

/** What the sandbox connector "sent". Real connectors replace these with real effects. */
export const outbox = pgTable('outbox', {
  id: id(),
  tenantId: tenantId(),
  toolCallId: uuid('tool_call_id').references(() => toolCalls.id, { onDelete: 'set null' }),
  kind: text('kind', { enum: ['message', 'payment_request', 'refund', 'schedule', 'document'] }).notNull(),
  status: text('status', { enum: ['draft', 'simulated'] }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
});

export const knowledgeDocs = pgTable('knowledge_docs', {
  id: id(),
  tenantId: tenantId(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  createdAt: createdAt(),
});

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: id(),
    tenantId: tenantId(),
    docId: uuid('doc_id').notNull().references(() => knowledgeDocs.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    content: text('content').notNull(),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('english', content)`),
    /** Filled once an embedding provider is configured; search falls back to full text. */
    embedding: vector('embedding', { dimensions: 1024 }),
  },
  (t) => [index('knowledge_chunks_tsv_idx').using('gin', t.tsv)],
);

/** Metering for every model call: tokens and cost per tenant, goal and task. */
export const llmCalls = pgTable(
  'llm_calls',
  {
    id: id(),
    tenantId: tenantId(),
    goalId: uuid('goal_id'),
    taskId: uuid('task_id'),
    purpose: text('purpose').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    tier: text('tier').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    costInr: money('cost_inr'),
    latencyMs: integer('latency_ms').notNull().default(0),
    redactions: integer('redactions').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('llm_calls_tenant_created_idx').on(t.tenantId, t.createdAt)],
);

/** Append-only, hash-chained audit log: the system of record for every action. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: id(),
    tenantId: tenantId(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    actorId: uuid('actor_id'),
    actorKind: text('actor_kind', { enum: ['human', 'agent', 'system'] }).notNull(),
    goalId: uuid('goal_id'),
    taskId: uuid('task_id'),
    refId: uuid('ref_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('audit_events_tenant_seq_idx').on(t.tenantId, t.seq),
    index('audit_events_goal_idx').on(t.tenantId, t.goalId),
  ],
);

export const auditHeads = pgTable('audit_heads', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  seq: bigint('seq', { mode: 'number' }).notNull(),
  hash: text('hash').notNull(),
});

/** People in charge: company staff the AI delegates work to by phone. */
export const staff = pgTable(
  'staff',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    title: text('title').notNull(),
    responsibilities: text('responsibilities').array().notNull().default(sql`'{}'::text[]`),
    workingHours: jsonb('working_hours').$type<WorkingHours>().notNull(),
    language: text('language', { enum: ['en'] }).notNull().default('en'),
    status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [index('staff_tenant_idx').on(t.tenantId)],
);

/** A repeating check-in (e.g. the daily work report), collected by phone or filled in by hand. */
export const routines = pgTable(
  'routines',
  {
    id: id(),
    tenantId: tenantId(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    templateId: text('template_id'),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    mode: text('mode', { enum: ['manual', 'automatic'] }).notNull().default('automatic'),
    days: integer('days').array().notNull(),
    time: text('time').notNull(),
    chaseMissing: boolean('chase_missing').notNull().default(true),
    questions: jsonb('questions').$type<RoutineQuestion[]>().notNull(),
    staffIds: uuid('staff_ids').array().notNull().default(sql`'{}'::uuid[]`),
    status: text('status', { enum: ['active', 'paused'] }).notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('routines_tenant_idx').on(t.tenantId)],
);

/** One person's answers to a routine for one day (India date). */
export const routineEntries = pgTable(
  'routine_entries',
  {
    id: id(),
    tenantId: tenantId(),
    routineId: uuid('routine_id').notNull().references(() => routines.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    status: text('status').$type<CheckinStatus>().notNull().default('pending'),
    source: text('source', { enum: ['manual', 'call'] }),
    values: jsonb('values').$type<Record<string, CheckinValue>>().notNull().default({}),
    flags: jsonb('flags').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('routine_entries_day_idx').on(t.routineId, t.staffId, t.date), index('routine_entries_date_idx').on(t.tenantId, t.date)],
);

/** Work handed to a person in charge, tracked through assign → follow-up → confirm calls. */
export const delegations = pgTable(
  'delegations',
  {
    id: id(),
    tenantId: tenantId(),
    goalId: uuid('goal_id').notNull().references(() => goals.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    toolCallId: uuid('tool_call_id').notNull().unique().references(() => toolCalls.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id').notNull().references(() => staff.id),
    title: text('title').notNull(),
    instructions: text('instructions').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    status: text('status').$type<DelegationStatus>().notNull().default('assigning'),
    stage: text('stage').$type<CallStage | 'closed'>().notNull().default('assign'),
    nextCallAt: timestamp('next_call_at', { withTimezone: true }),
    outcome: jsonb('outcome').$type<{ summary: string; notes?: string | null }>(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('delegations_staff_idx').on(t.tenantId, t.staffId), index('delegations_task_idx').on(t.taskId)],
);

/** Every phone call: who, which stage, attempt, transcript and what it established. */
export const calls = pgTable(
  'calls',
  {
    id: id(),
    tenantId: tenantId(),
    /** Set for calls about delegated work. */
    delegationId: uuid('delegation_id').references(() => delegations.id, { onDelete: 'cascade' }),
    /** Set for routine check-in calls. */
    checkinId: uuid('checkin_id').references(() => routineEntries.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id').notNull().references(() => staff.id),
    stage: text('stage').$type<CallStage>().notNull(),
    attempt: integer('attempt').notNull(),
    status: text('status').$type<CallStatus>().notNull().default('scheduled'),
    provider: text('provider').notNull(),
    providerCallId: text('provider_call_id'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    transcript: jsonb('transcript').$type<TranscriptLine[]>().notNull().default([]),
    summary: text('summary'),
    outcome: text('outcome').$type<CallOutcome>(),
    /** Delegation calls: deadline and notes. Check-in calls: answers so far and re-asks per question. */
    extracted: jsonb('extracted')
      .$type<{ dueAt?: string | null; notes?: string | null; values?: Record<string, CheckinValue>; retries?: Record<string, number> }>()
      .notNull()
      .default({}),
    costInr: money('cost_inr'),
    createdAt: createdAt(),
  },
  (t) => [index('calls_delegation_idx').on(t.delegationId), index('calls_checkin_idx').on(t.checkinId), index('calls_status_idx').on(t.tenantId, t.status)],
);
