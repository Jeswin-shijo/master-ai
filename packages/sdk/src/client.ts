import type {
  AgentView,
  Company,
  AcceptInviteInput,
  CreateInviteInput,
  CreatedInvite,
  Invite,
  InviteView,
  Member,
  UpdateMemberInput,
  CancelCaseInput,
  Case,
  CaseDetail,
  CaseInfoInput,
  CreateCaseInput,
  CreateIntakeKeyInput,
  CreatedIntakeKey,
  IntakeCaseInput,
  IntakeKey,
  PublicForm,
  PublicFormInput,
  ApprovalDecisionInput,
  ApprovalRequest,
  AuditEvent,
  AuditVerifyResult,
  AuthResponse,
  CallRecord,
  CheckinInput,
  CreateRoutineInput,
  CreateStaffInput,
  Delegation,
  StaffMember,
  UpdateStaffInput,
  AutonomyOverride,
  AutonomyOverrideInput,
  AutonomySuggestion,
  BatchApprovalInput,
  CreateGoalInput,
  CreateKnowledgeDocInput,
  DeviceKey,
  Goal,
  GoalReport,
  KnowledgeDoc,
  LoginInput,
  OpsOverview,
  OutboxItem,
  PackDraft,
  PackInstallInput,
  PackPreviewInput,
  PackRecord,
  PackUpdates,
  PlanDecisionInput,
  PolicyRule,
  ReportPeriod,
  Routine,
  RoutineDay,
  RoutineTemplate,
  Pulse,
  RegisterDeviceKeyInput,
  RegisterPushTokenInput,
  SessionUser,
  SignupInput,
  Task,
  TenantSettingsInput,
  TenantSummary,
  ToolCall,
  UpdateAgentInput,
  UpdateRoutineInput,
  VoiceStatus,
  WorkReport,
  Workspace,
} from '@onehuman/schemas';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ClientOptions {
  baseUrl: string;
  /** Returns the current session token, if any. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  fetch?: typeof fetch;
}

export interface GoalDetail {
  goal: Goal;
  tasks: Task[];
  toolCalls: ToolCall[];
  approvals: ApprovalRequest[];
  /** The goal's outcome in plain words. */
  report: GoalReport;
}

export interface RegistryPackSummary {
  id: string;
  name: string;
  description: string;
  kind: 'base' | 'industry';
  version: string;
}

export interface WorkspacePolicy {
  version: number;
  rules: PolicyRule[];
  cedar: string;
}

export type ApiClient = ReturnType<typeof createClient>;

/** Typed client for the ONEHUMAN OS API, shared by web, mobile and partners. */
export function createClient(options: ClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const token = await options.getToken?.();
    const res = await doFetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data: unknown = text ? safeJson(text) : null;
    if (!res.ok) {
      const bodyMessage =
        data && typeof data === 'object' && 'message' in data ? formatMessage((data as { message: unknown }).message) : '';
      const message = bodyMessage || res.statusText || `Request failed (${res.status})`;
      throw new ApiError(res.status, message, data);
    }
    return data as T;
  }

  const get = <T>(path: string) => request<T>('GET', path);
  const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
  const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
  const del = <T>(path: string) => request<T>('DELETE', path);
  const qs = (params: Record<string, string | number | undefined>) => {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string | number][];
    return entries.length ? `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}` : '';
  };

  return {
    baseUrl,
    auth: {
      signup: (input: SignupInput) => post<AuthResponse>('/auth/signup', input),
      login: (input: LoginInput) => post<AuthResponse>('/auth/login', input),
      me: () => get<{ user: SessionUser; tenant: TenantSummary; companies: Company[] }>('/auth/me'),
      /** Open another company this login belongs to. */
      switchCompany: (tenantId: string) => post<AuthResponse>('/auth/switch', { tenantId }),
      registerDeviceKey: (input: RegisterDeviceKeyInput) => post<DeviceKey>('/auth/device-keys', input),
      deviceKeys: () => get<DeviceKey[]>('/auth/device-keys'),
      registerPushToken: (input: RegisterPushTokenInput) => post<{ ok: true }>('/auth/push-tokens', input),
    },
    onboarding: {
      preview: (input: PackPreviewInput = {}) => post<PackDraft>('/onboarding/preview', input),
      install: (input: PackInstallInput) => post<Workspace>('/onboarding/install', input),
    },
    packs: {
      registry: () => get<RegistryPackSummary[]>('/packs/registry'),
    },
    tenant: {
      get: () => get<TenantSummary>('/tenant'),
      updateSettings: (input: TenantSettingsInput) => patch<TenantSummary>('/tenant/settings', input),
      pause: () => post<TenantSummary>('/tenant/pause'),
      resume: () => post<TenantSummary>('/tenant/resume'),
    },
    workspaces: {
      list: () => get<Workspace[]>('/workspaces'),
      get: (id: string) => get<Workspace>(`/workspaces/${id}`),
      policy: (id: string) => get<WorkspacePolicy>(`/workspaces/${id}/policy`),
      updates: (id: string) => get<PackUpdates>(`/workspaces/${id}/updates`),
      applyUpdates: (id: string) => post<Workspace>(`/workspaces/${id}/updates`),
      pause: (id: string) => post<Workspace>(`/workspaces/${id}/pause`),
      resume: (id: string) => post<Workspace>(`/workspaces/${id}/resume`),
    },
    agents: {
      list: () => get<AgentView[]>('/agents'),
      get: (id: string) => get<AgentView>(`/agents/${id}`),
      update: (id: string, input: UpdateAgentInput) => patch<AgentView>(`/agents/${id}`, input),
      pause: (id: string) => post<AgentView>(`/agents/${id}/pause`),
      resume: (id: string) => post<AgentView>(`/agents/${id}/resume`),
      suggestions: () => get<AutonomySuggestion[]>('/agents/autonomy/suggestions'),
      addOverride: (id: string, input: AutonomyOverrideInput) => post<AutonomyOverride>(`/agents/${id}/overrides`, input),
      removeOverride: (id: string, overrideId: string) => del<{ ok: true }>(`/agents/${id}/overrides/${overrideId}`),
    },
    goals: {
      list: () => get<Goal[]>('/goals'),
      get: (id: string) => get<GoalDetail>(`/goals/${id}`),
      create: (input: CreateGoalInput) => post<Goal>('/goals', input),
      decidePlan: (id: string, input: PlanDecisionInput) => post<Goal>(`/goals/${id}/plan-decision`, input),
    },
    cases: {
      /** Open cases (the default) or every case, newest first. */
      list: (status: 'open' | 'all' = 'open') => get<Case[]>(`/cases${qs({ status })}`),
      get: (id: string) => get<CaseDetail>(`/cases/${id}`),
      create: (input: CreateCaseInput) => post<Case>('/cases', input),
      /** Give the details review asked for; review runs again. */
      addInfo: (id: string, input: CaseInfoInput) => post<Case>(`/cases/${id}/info`, input),
      cancel: (id: string, input: CancelCaseInput = {}) => post<Case>(`/cases/${id}/cancel`, input),
    },
    intakeKeys: {
      list: () => get<IntakeKey[]>('/intake-keys'),
      create: (input: CreateIntakeKeyInput) => post<CreatedIntakeKey>('/intake-keys', input),
      revoke: (id: string) => post<IntakeKey>(`/intake-keys/${id}/revoke`),
    },
    intake: {
      /** Public: what the request form shows. */
      form: (tenantId: string, key: string) => get<PublicForm>(`/intake/${tenantId}/forms/${encodeURIComponent(key)}`),
      /** Public: a customer sends a request through the form. */
      submitForm: (tenantId: string, key: string, input: PublicFormInput) =>
        post<{ code: string }>(`/intake/${tenantId}/forms/${encodeURIComponent(key)}`, input),
      /** Systems and partners, authenticated by an intake API key instead of a session. */
      submit: (tenantId: string, key: string, input: IntakeCaseInput) =>
        request<{ caseId: string; code: string; duplicate: boolean }>('POST', `/intake/${tenantId}/cases`, input, { Authorization: `Bearer ${key}` }),
    },
    members: {
      list: () => get<Member[]>('/members'),
      update: (id: string, input: UpdateMemberInput) => patch<Member>(`/members/${id}`, input),
      remove: (id: string) => post<Member>(`/members/${id}/remove`),
    },
    invites: {
      list: () => get<Invite[]>('/members/invites'),
      create: (input: CreateInviteInput) => post<CreatedInvite>('/members/invites', input),
      revoke: (id: string) => post<Invite>(`/members/invites/${id}/revoke`),
      /** Public: what the invite page shows. */
      view: (tenantId: string, token: string) => get<InviteView>(`/invites/${tenantId}/${encodeURIComponent(token)}`),
      /** Public: join the company; returns a session for it. */
      accept: (tenantId: string, token: string, input: AcceptInviteInput) =>
        post<AuthResponse>(`/invites/${tenantId}/${encodeURIComponent(token)}/accept`, input),
    },
    approvals: {
      /** `mine`: only what this person may decide (the default in the apps). */
      list: (status: 'pending' | 'all' = 'pending', opts: { mine?: boolean } = {}) =>
        get<ApprovalRequest[]>(`/approvals${qs({ status, ...(opts.mine && { mine: 'true' }) })}`),
      get: (id: string) => get<ApprovalRequest>(`/approvals/${id}`),
      decide: (id: string, input: ApprovalDecisionInput) => post<ApprovalRequest>(`/approvals/${id}/decide`, input),
      batch: (input: BatchApprovalInput) =>
        post<{ results: { approvalId: string; ok: boolean; error?: string }[] }>('/approvals/batch', input),
    },
    audit: {
      list: (params: { goalId?: string; limit?: number; beforeSeq?: number } = {}) =>
        get<AuditEvent[]>(`/audit${qs(params)}`),
      verify: () => get<AuditVerifyResult>('/audit/verify'),
    },
    records: {
      list: (entity: string, query?: string) => get<PackRecord[]>(`/records/${encodeURIComponent(entity)}${qs({ q: query })}`),
      create: (entity: string, data: Record<string, unknown>) =>
        post<PackRecord>(`/records/${encodeURIComponent(entity)}`, { data }),
      outbox: () => get<OutboxItem[]>('/outbox'),
    },
    knowledge: {
      list: () => get<KnowledgeDoc[]>('/knowledge'),
      create: (input: CreateKnowledgeDocInput) => post<KnowledgeDoc>('/knowledge', input),
    },
    ops: {
      overview: () => get<OpsOverview>('/ops/overview'),
      pulse: () => get<Pulse>('/ops/pulse'),
    },
    team: {
      list: () => get<StaffMember[]>('/team'),
      add: (input: CreateStaffInput) => post<StaffMember>('/team', input),
      update: (id: string, input: UpdateStaffInput) => patch<StaffMember>(`/team/${id}`, input),
    },
    calls: {
      list: () => get<CallRecord[]>('/calls'),
      active: () => get<CallRecord[]>(`/calls${qs({ status: 'active' })}`),
      get: (id: string) => get<CallRecord>(`/calls/${id}`),
      /** Simulator: answer as the staff member. */
      answer: (id: string) => post<CallRecord>(`/calls/${id}/answer`),
      /** Simulator: speak as the staff member; returns the call with the AI's reply. */
      reply: (id: string, text: string) => post<CallRecord>(`/calls/${id}/reply`, { text }),
      decline: (id: string) => post<CallRecord>(`/calls/${id}/decline`),
    },
    routines: {
      list: () => get<Routine[]>('/routines'),
      /** Check-ins the industry setup offers, ready to switch on. */
      templates: () => get<(RoutineTemplate & { inUse: boolean })[]>('/routines/templates'),
      create: (input: CreateRoutineInput) => post<Routine>('/routines', input),
      day: (id: string, date?: string) => get<RoutineDay>(`/routines/${id}${qs({ date })}`),
      update: (id: string, input: UpdateRoutineInput) => patch<Routine>(`/routines/${id}`, input),
      /** Fill in today's check-in by hand. */
      submit: (id: string, input: CheckinInput) => post<RoutineDay>(`/routines/${id}/checkins`, input),
      /** Call everyone who has not reported today, right now. */
      run: (id: string) => post<{ ok: true }>(`/routines/${id}/run`),
    },
    reports: {
      /** What got done in a period, in plain language: today, the last 7 or 30 days, or everything. */
      list: (period: ReportPeriod = 'week') => get<WorkReport>(`/reports${qs({ period })}`),
    },
    voice: {
      /** Whether this server can place real phone calls, and what is missing if not. */
      status: () => get<VoiceStatus>('/voice/status'),
    },
    delegations: {
      list: (goalId?: string) => get<Delegation[]>(`/delegations${qs({ goalId })}`),
    },
    /** URL for the agent-text SSE stream of one task. */
    taskStreamUrl: (taskId: string, token: string) => `${baseUrl}/tasks/${taskId}/stream${qs({ token })}`,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatMessage(m: unknown): string {
  if (Array.isArray(m)) return m.join('; ');
  return String(m);
}
