/**
 * Every state change is an audit event. The same events stream to clients over
 * WebSocket, so the web and mobile apps refresh from one source of truth.
 */
export const AUDIT_EVENT_TYPES = [
  'tenant.created',
  'tenant.paused',
  'tenant.resumed',
  'tenant.settings_updated',
  'pack.drafted',
  'pack.installed',
  'pack.updated',
  'workspace.paused',
  'workspace.resumed',
  'agent.created',
  'agent.updated',
  'agent.paused',
  'agent.resumed',
  'autonomy.override_set',
  'autonomy.override_removed',
  'device.registered',
  'goal.created',
  'goal.planned',
  'goal.plan_approved',
  'goal.plan_rejected',
  'goal.completed',
  'goal.failed',
  'task.started',
  'task.paused',
  'task.resumed',
  'task.completed',
  'task.escalated',
  'task.failed',
  'task.skipped',
  'action.proposed',
  'policy.decided',
  'action.executed',
  'action.failed',
  'action.blocked',
  'approval.requested',
  'approval.decided',
  'approval.expired',
  'quality.checked',
  'record.created',
  'knowledge.added',
  'staff.added',
  'staff.updated',
  'delegation.created',
  'delegation.updated',
  'call.ringing',
  'call.completed',
  'call.no_answer',
  'routine.created',
  'routine.updated',
  'routine.run_started',
  'routine.run_finished',
  'checkin.reported',
  'checkin.missed',
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/** Pushed over WebSocket for every committed audit event. */
export interface RealtimeEvent {
  kind: 'event';
  type: AuditEventType;
  seq: number;
  goalId: string | null;
  taskId: string | null;
  refId: string | null;
  summary: string;
  at: string;
}

/** Streamed over SSE while an agent is thinking about its next step. */
export interface AgentTextChunk {
  taskId: string;
  delta: string;
  done?: boolean;
}

/** Turns an event into a one-line human summary for feeds and notifications. */
export function summarizeEvent(type: AuditEventType, payload: Record<string, unknown>): string {
  const p = payload as Record<string, string | number | undefined>;
  switch (type) {
    case 'goal.created':
      return `New goal: ${p.text ?? ''}`;
    case 'goal.planned':
      return `Plan ready with ${p.taskCount ?? '?'} task(s)`;
    case 'goal.completed':
      return `Goal finished (${p.status ?? 'completed'})`;
    case 'task.started':
      return `${p.agentName ?? 'Agent'} started "${p.title ?? ''}"`;
    case 'task.completed':
      return `${p.agentName ?? 'Agent'} finished "${p.title ?? ''}"`;
    case 'task.escalated':
      return `Task needs a human: ${p.reason ?? ''}`;
    case 'action.executed':
      return `Ran ${p.tool ?? 'tool'}`;
    case 'action.blocked':
      return `Blocked ${p.tool ?? 'tool'}: ${p.reason ?? ''}`;
    case 'approval.requested':
      return `Approval needed: ${p.summary ?? p.tool ?? ''}`;
    case 'approval.decided':
      return `Approval ${p.decision ?? 'decided'} for ${p.tool ?? 'action'}`;
    case 'delegation.created':
      return `Delegated to ${p.staffName ?? 'staff'}: ${p.title ?? ''}`;
    case 'delegation.updated':
      return `${p.staffName ?? 'Staff'}: ${String(p.status ?? '').replace(/_/g, ' ')}${p.title ? ` — ${p.title}` : ''}`;
    case 'call.ringing':
      return `Calling ${p.staffName ?? 'staff'} (${String(p.stage ?? '').replace('_', ' ')})`;
    case 'call.completed':
      return `Call with ${p.staffName ?? 'staff'}: ${p.summary ?? p.outcome ?? 'completed'}`;
    case 'call.no_answer':
      return `${p.staffName ?? 'Staff'} did not answer (attempt ${p.attempt ?? '?'})`;
    case 'routine.created':
      return `New routine: ${p.name ?? ''}`;
    case 'routine.updated':
      return `Routine changed: ${p.name ?? ''}`;
    case 'routine.run_started':
      return `${p.name ?? 'Routine'} started: calling ${p.calling ?? 0} ${p.calling === 1 ? 'person' : 'people'}`;
    case 'routine.run_finished':
      return `${p.name ?? 'Routine'}: ${p.reported ?? 0} of ${p.expected ?? 0} reported${p.flags ? `, ${p.flags} problem(s)` : ''}`;
    case 'checkin.reported':
      return `${p.staffName ?? 'Someone'} reported for ${p.name ?? 'the routine'}${p.source === 'call' ? ' (by phone)' : ''}`;
    case 'checkin.missed':
      return `No ${p.name ?? 'update'} from ${p.staffName ?? 'someone'}`;
    case 'pack.updated':
      return `Workspace updated: added ${p.summary ?? 'platform additions'}`;
    case 'staff.added':
      return `Team: added ${p.name ?? 'a person'}`;
    case 'agent.paused':
    case 'workspace.paused':
    case 'tenant.paused':
      return `Kill switch: ${type.split('.')[0]} paused`;
    default:
      return type.replace('.', ' ').replace(/_/g, ' ');
  }
}
