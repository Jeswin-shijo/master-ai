import type { AgentJobCardView, AgentView, JobView } from '@onehuman/schemas';

/** A customer-facing desk's card: one set every customer desk inherits (with a word the owner added), one set the owner added. */
export const CARD: AgentJobCardView = {
  mission: 'Register supply complaints and keep consumers updated.',
  may: ['records.search', 'message.send'],
  never: ['Grid switching', 'Electrical safety decisions'],
  customerFacing: true,
  escalations: [
    {
      id: 'emergency',
      label: 'Emergencies',
      // The pack's words, then one the owner added in an earlier save.
      words: ['fire', 'gas leak', 'करंट', 'cylinder blast'],
      reply: 'If anyone is in danger, please call 112 now.',
      alert: 'owner',
      inherited: true,
      fromPack: true,
      packWords: ['fire', 'gas leak', 'करंट'],
    },
    { id: 'meter-tamper', label: 'Meter tampering', words: ['tampered'], reply: null, alert: 'owner', inherited: false, fromPack: false, packWords: [] },
  ],
  forbidden: ['refund.issue'],
  trialDays: 14,
};

export const JOB: JobView = {
  id: 'morning-check',
  name: 'Morning check',
  description: 'Looks over the day before the shift starts.',
  agentRole: 'consumer-desk',
  trigger: 'schedule',
  triggerText: 'Every Mon–Sat at 09:00',
  enabled: true,
  dailyCap: 50,
  lastRun: {
    id: 'run-1',
    jobId: 'morning-check',
    trigger: 'schedule',
    status: 'needs_person',
    summary: 'A consumer mentioned a gas leak',
    flags: [],
    createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    finishedAt: null,
    goalId: 'goal-1',
    caseId: null,
  },
};

export function agentWith(over: Partial<AgentView> = {}): AgentView {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    role: 'consumer-desk',
    name: 'Consumer service desk',
    description: 'Registers supply complaints.',
    status: 'active',
    autonomy: 3,
    tools: ['records.search', 'message.send', 'refund.issue'],
    spec: {} as AgentView['spec'],
    model: { tier: 'standard', dataClass: 'confidential' },
    stats: { tasksCompleted: 0, approvalsRequested: 0, approvalsRejected: 0, spendInr: 0 },
    overrides: [],
    job: CARD,
    jobs: [],
    ...over,
  };
}
