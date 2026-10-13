import { describe, expect, it } from 'vitest';
import { LifecycleSchema } from '@onehuman/schemas';
import { mergeLifecycles } from '@onehuman/agent-kit';
import { buildCaseReport, type CaseRow, type StageRow } from './case-report';

const lc = mergeLifecycles([LifecycleSchema.parse({ stages: { approve: { name: 'Permit & Isolation Approval' } } })]);
const t = (min: number) => new Date(Date.UTC(2026, 9, 13, 4, min));

const caseRow = (over: Partial<CaseRow> = {}): CaseRow => ({
  id: 'c1', tenantId: 't1', workspaceId: 'w1', number: 42, code: 'WO-0042', title: 'Boiler feed pump B vibration', source: 'staff',
  requester: { name: 'Ravi' }, externalRef: null, category: 'breakdown', categoryName: 'Breakdown', priority: 'P2', risk: 'medium',
  department: 'Maintenance', amountInr: null, assignee: null, respondBy: null, resolveBy: null, stage: 'approve', status: 'waiting_approval',
  outcome: null, file: {}, goalId: null, workflowId: 'case-c1', createdBy: null, createdAt: t(0), updatedAt: t(5), closedAt: null, ...over,
});
const stage = (key: StageRow['stage'], attempt: number, status: StageRow['status'], from: number, to: number | null, summary: string): StageRow => ({
  id: `${key}-${attempt}`, tenantId: 't1', caseId: 'c1', stage: key, attempt, name: lc.stages.find((s) => s.key === key)!.name, status,
  input: null, output: null, summary, actor: 'Case coordinator (rules)', workflowId: null, startedAt: t(from), completedAt: to === null ? null : t(to), createdAt: t(from),
});

describe('case report', () => {
  it('says where an open case is and lists all 8 stages', () => {
    const report = buildCaseReport(caseRow(), [stage('request', 1, 'done', 0, 0, 'Received from Ravi.'), stage('approve', 1, 'waiting_approval', 3, null, 'Waiting for the Safety officer.')], null, lc);
    expect(report.text).toBe('WO-0042 Boiler feed pump B vibration is waiting for approval (Permit & Isolation Approval).');
    expect(report.stages).toHaveLength(8);
    expect(report.stages[0]).toMatchObject({ stage: 'request', status: 'done', minutes: 0 });
    expect(report.stages[4]).toMatchObject({ stage: 'approve', name: 'Permit & Isolation Approval', status: 'waiting_approval', minutes: null });
    expect(report.stages[5]).toMatchObject({ stage: 'execute', status: 'pending', summary: null });
  });

  it('shows the latest attempt of a stage that ran twice', () => {
    const report = buildCaseReport(caseRow({ stage: 'close', status: 'in_progress' }), [stage('execute', 1, 'done', 5, 20, 'First try.'), stage('execute', 2, 'done', 30, 50, 'Second try.')], null, lc);
    expect(report.stages[5]).toMatchObject({ summary: 'Second try.', minutes: 20 });
  });

  it('uses the stage-8 report once the case is closed', () => {
    const closed = caseRow({
      status: 'closed', stage: 'report', closedAt: t(90), outcome: 'Resolved: pump realigned.',
      file: { report: { text: 'WO-0042 Boiler feed pump B vibration was resolved in 1 h 30 min, inside its 24 h target.', slaMet: true, minutesPerStage: [], recurring: null } },
    });
    const report = buildCaseReport(closed, [], null, lc);
    expect(report.text).toContain('was resolved in 1 h 30 min');
    expect(report.slaMet).toBe(true);
    expect(report.closedAt).toBe(t(90).toISOString());
  });
});
