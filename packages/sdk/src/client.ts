import type {
  AgentView,
  ApprovalDecisionInput,
  ApprovalRequest,
  AuditEvent,
  AuditVerifyResult,
  AuthResponse,
  CallRecord,
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

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await options.getToken?.();
    const res = await doFetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
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
      me: () => get<{ user: SessionUser; tenant: TenantSummary }>('/auth/me'),
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
    approvals: {
      list: (status: 'pending' | 'all' = 'pending') => get<ApprovalRequest[]>(`/approvals${qs({ status })}`),
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
