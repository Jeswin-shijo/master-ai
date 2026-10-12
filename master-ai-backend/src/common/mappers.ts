import type {
  ApprovalRequest,
  Goal,
  GoalStatus,
  PackDraft,
  Task,
  TaskStatus,
  TenantSettings,
  TenantSummary,
  ToolCall,
  ToolCallStatus,
  Workspace,
} from '@onehuman/schemas';
import type {
  approvalRequests,
  goals,
  packDrafts,
  tasks,
  tenants,
  toolCalls,
  workspaces,
} from '../db/schema';

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  redactPii: true,
  riskBands: { level1Below: 15, level2Below: 35, level3Below: 75 },
  approvalTtlHours: 72,
  calls: { provider: 'simulator', simulatorMode: 'interactive', fastSchedule: true, maxAttempts: 3, retryMinutes: 15 },
};

export function toTenant(t: typeof tenants.$inferSelect): TenantSummary {
  return {
    id: t.id,
    name: t.name,
    industry: t.industry,
    status: t.status,
    onboarded: t.onboarded,
    settings: { ...DEFAULT_TENANT_SETTINGS, ...t.settings, calls: { ...DEFAULT_TENANT_SETTINGS.calls, ...t.settings.calls } },
  };
}

export function toWorkspace(w: typeof workspaces.$inferSelect): Workspace {
  return {
    id: w.id,
    name: w.name,
    packId: w.packId,
    packVersion: w.packVersion,
    status: w.status,
    pack: w.pack,
    createdAt: w.createdAt.toISOString(),
  };
}

export function toDraft(d: typeof packDrafts.$inferSelect): PackDraft {
  return {
    id: d.id,
    industry: d.industry,
    source: d.source,
    generator: d.generator,
    rationale: d.rationale,
    pack: d.pack,
    status: d.status,
    createdAt: d.createdAt.toISOString(),
  };
}

export function toGoal(g: typeof goals.$inferSelect): Goal {
  return {
    id: g.id,
    workspaceId: g.workspaceId,
    text: g.text,
    status: g.status as GoalStatus,
    plan: g.plan ?? null,
    summary: g.summary,
    tokens: g.tokens,
    costInr: g.costInr,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
    completedAt: g.completedAt?.toISOString() ?? null,
  };
}

export function toTask(t: typeof tasks.$inferSelect, agent: { role: string; name: string }): Task {
  return {
    id: t.id,
    goalId: t.goalId,
    key: t.key,
    title: t.title,
    description: t.description,
    agentId: t.agentId,
    agentRole: agent.role,
    agentName: agent.name,
    dependsOn: t.dependsOn,
    status: t.status as TaskStatus,
    waitingOn: t.waitingOn,
    output: t.output ?? null,
    steps: t.steps,
    tokens: t.tokens,
    costInr: t.costInr,
    startedAt: t.startedAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
  };
}

export function toToolCall(c: typeof toolCalls.$inferSelect): ToolCall {
  return {
    id: c.id,
    taskId: c.taskId,
    agentId: c.agentId,
    tool: c.tool,
    args: c.args,
    rationale: c.rationale,
    status: c.status as ToolCallStatus,
    decision: c.decision ?? null,
    result: c.result ?? null,
    error: c.error,
    createdAt: c.createdAt.toISOString(),
    executedAt: c.executedAt?.toISOString() ?? null,
  };
}

export function toApproval(a: typeof approvalRequests.$inferSelect, agentName: string): ApprovalRequest {
  return {
    id: a.id,
    goalId: a.goalId,
    taskId: a.taskId,
    toolCallId: a.toolCallId,
    agentId: a.agentId,
    agentName,
    tool: a.tool,
    args: a.args,
    summary: a.summary,
    rationale: a.rationale,
    riskScore: a.decision.riskScore,
    factors: a.decision.factors,
    reasons: a.decision.reasons,
    evidence: a.evidence,
    costSoFarInr: a.costSoFarInr,
    approver: a.approver,
    status: a.status,
    expiresAt: a.expiresAt.toISOString(),
    decidedBy: a.decidedBy,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    decisionNotes: a.decisionNotes,
    editedArgs: a.editedArgs ?? null,
    signature: a.signature,
    createdAt: a.createdAt.toISOString(),
  };
}

/** What an action is about, e.g. { label: 'Booking', title: 'Rahul Nair' }. */
export interface ActionTarget {
  label: string;
  title?: string;
}

/** A one-line, owner-readable description of a proposed action. */
export function describeAction(tool: string, args: Record<string, unknown>, target?: ActionTarget): string {
  const amount = typeof args.amount === 'number' ? `₹${args.amount.toLocaleString('en-IN')}` : null;
  const to = (args.to ?? args.recipient ?? args.payer) as string | undefined;
  const patch = args.patch as Record<string, unknown> | undefined;
  const label = target?.label ?? (args.entity as string | undefined);
  const what = label ? `${label.toLowerCase()}${target?.title ? ` for ${target.title}` : ''}` : 'record';
  switch (tool) {
    case 'refund.issue':
      return `Refund ${amount ?? ''} to ${to ?? 'customer'}${args.reason ? ` (${String(args.reason)})` : ''}`;
    case 'payment.request':
      return `Request ${amount ?? 'payment'} from ${to ?? 'customer'}${args.purpose ? ` for ${String(args.purpose)}` : ''}`;
    case 'message.send':
      return `Send ${String(args.channel ?? 'message')} to ${to ?? 'recipient'}: "${truncate(String(args.body ?? ''), 80)}"`;
    case 'message.draft':
      return `Draft ${String(args.channel ?? 'message')} to ${to ?? 'recipient'}`;
    case 'records.create':
      return `Create ${what}`;
    case 'records.update':
      return `Update ${what}${patch?.status ? ` → ${String(patch.status)}` : ''}`;
    case 'schedule.create':
      return `Schedule "${String(args.title ?? '')}" at ${String(args.start ?? '')}`;
    default: {
      // Pack tools read as verb + object: booking.cancel → "Cancel booking for Rahul Nair".
      const verb = (tool.split('.').pop() ?? tool).replace(/_/g, ' ');
      const object = label ? what : tool.split('.')[0];
      return `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${object}${amount ? ` (${amount})` : ''}`;
    }
  }
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
