import { describe, expect, it } from 'vitest';
import type { CaseDetail } from '@onehuman/schemas';
import { caseReportText, caseReportView, goalTitle } from './case-report';

const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');
const words = {
  when,
  roleName: (id: string) => ({ 'plant-head': 'the plant head', 'safety-officer': 'the safety officer', owner: 'the owner' })[id] ?? 'the right person',
  priorityName: (p: string) => ({ P1: 'Critical' })[p],
};
const NAMES = ['Job raised', "Engineer's first check", 'Category & priority set', 'Crew & supervisor named', 'Permit & clearance', 'Work under permit', 'Permit return & sign-off', 'Monthly review & lessons'];
const KEYS = ['request', 'review', 'classify', 'assign', 'approve', 'execute', 'close', 'report'] as const;

function detail(over: { status?: string; pendingSignoff?: boolean } = {}): CaseDetail {
  return {
    case: {
      id: '8f1d2c3b-0000-4000-8000-000000000001',
      code: 'JOB-0001',
      title: 'Lineman shock on Kamalpur feeder',
      source: 'staff',
      requester: { name: 'Ravi Kumar' },
      categoryName: 'Accident or near miss',
      priority: 'P1',
      risk: 'high',
      department: 'Safety',
      amountInr: 25000,
      assignee: { name: 'Suresh', title: 'Shift engineer' },
      resolveBy: '2026-10-14T12:00:00Z',
      status: over.status ?? 'closed',
      outcome: 'Resolved: the lineman is safe and the feeder was isolated.',
      goalId: '9a9a9a9a-0000-4000-8000-000000000002',
      createdAt: '2026-10-14T08:00:00Z',
      closedAt: '2026-10-14T08:03:00Z',
    },
    label: { label: 'Job', plural: 'Jobs', prefix: 'JOB' },
    file: {
      request: { title: 'Lineman shock', summary: 'Shock on the 11 kV feeder.', requester: { name: 'Ravi Kumar' }, source: 'staff', receivedAt: '2026-10-14T08:00:00Z', text: 'Sir, contract lineman Ramesh got shock…' },
      approve: { required: true, approverRole: 'plant-head', decision: 'approved', decidedBy: 'Anil', notes: 'Isolate first' },
      close: over.pendingSignoff
        ? { verified: true, findings: ['Feeder isolated.'], signoff: { required: true, role: 'safety-officer' }, outcome: 'resolved' }
        : { verified: true, findings: ['Feeder isolated.'], signoff: { required: true, role: 'safety-officer', decision: 'approved', by: 'Sunita' }, outcome: 'resolved' },
    },
    stages: [],
    approvals: [
      { kind: 'case_gate', stage: 'approve', approver: 'plant-head', status: 'approved', decidedAt: '2026-10-14T08:01:00Z', decisionNotes: 'Isolate first' },
      over.pendingSignoff
        ? { kind: 'case_gate', stage: 'close', approver: 'safety-officer', status: 'pending', decidedAt: null, decisionNotes: null }
        : { kind: 'case_gate', stage: 'close', approver: 'safety-officer', status: 'approved', decidedAt: '2026-10-14T08:02:30Z', decisionNotes: null },
      { kind: 'action', stage: null, approver: 'owner', status: 'approved', decidedAt: '2026-10-14T08:01:30Z', decisionNotes: null },
    ],
    report: {
      caseId: '8f1d2c3b-0000-4000-8000-000000000001',
      code: 'JOB-0001',
      title: 'Lineman shock on Kamalpur feeder',
      status: 'closed',
      outcome: 'Resolved: the lineman is safe and the feeder was isolated.',
      text: 'JOB-0001 was resolved in 3 min, inside its 4 h target.',
      slaMet: true,
      recurring: { count: 3, note: 'This is the third shock on this feeder in 30 days.' },
      stages: KEYS.map((stage, i) => ({ stage, name: NAMES[i]!, status: stage === 'assign' ? 'skipped' : 'done', minutes: stage === 'execute' ? 95 : i === 0 ? 0 : 1, summary: `${NAMES[i]} finished.` })),
      work: {
        goalId: '9a9a9a9a-0000-4000-8000-000000000002',
        text: 'Lineman shock… Do what this request needs. Look up the company playbooks and follow them.',
        status: 'completed',
        done: ['Recorded the accident involving contract lineman Ramesh.'],
        pending: [],
        attention: [],
        people: ['Suresh (Shift engineer): 1 call, done'],
      },
      createdAt: '2026-10-14T08:00:00Z',
      closedAt: '2026-10-14T08:03:00Z',
    },
  } as unknown as CaseDetail;
}

describe('caseReportView', () => {
  it('heads the report with the case, its status, its dates and whether it was on time', () => {
    const v = caseReportView(detail(), words);
    expect(v).toMatchObject({ code: 'JOB-0001', title: 'Lineman shock on Kamalpur feeder', label: 'Job', status: 'Closed', onTime: true });
    expect(v.dates).toBe('Raised 2026-10-14 08:00 · finished 2026-10-14 08:03');
    expect(v.summary).toEqual([
      'JOB-0001 was resolved in 3 min, inside its 4 h target.',
      'Resolved: the lineman is safe and the feeder was isolated.',
      'This is the third shock on this feeder in 30 days.',
    ]);
  });

  it('lists the details people ask about, in words', () => {
    expect(caseReportView(detail(), words).details).toEqual([
      { label: 'Requested by', value: 'Ravi Kumar, raised by the team' },
      { label: 'Kind of request', value: 'Accident or near miss' },
      { label: 'Priority', value: 'P1 · Critical' },
      { label: 'Risk', value: 'High' },
      { label: 'Department', value: 'Safety' },
      { label: 'Amount', value: '₹25,000' },
      { label: 'In charge', value: 'Suresh (Shift engineer)' },
    ]);
  });

  it('gives every stage in order, with its status, how long it took and what it found', () => {
    const { stages } = caseReportView(detail(), words);
    expect(stages.map((s) => s.name)).toEqual(NAMES);
    expect(stages[0]).toMatchObject({ n: 1, status: 'Done', took: 'under a minute' });
    expect(stages[3]).toMatchObject({ n: 4, status: 'Skipped', took: null });
    expect(stages[5]).toMatchObject({ status: 'Done', took: '1 h 35 min' });
    expect(stages[0]!.found.length).toBeGreaterThan(0); // from the case file
    expect(stages[7]!.found).toEqual(['Monthly review & lessons finished.']); // from the stage summary when the file has nothing
  });

  it('says who approved and who signed off, when, and with what note', () => {
    expect(caseReportView(detail(), words).decisions).toEqual([
      'Approval: approved by Anil (the plant head), 2026-10-14 08:01. Note: “Isolate first”',
      'Sign-off: approved by Sunita (the safety officer), 2026-10-14 08:02.',
    ]);
    expect(caseReportView(detail({ status: 'waiting_signoff', pendingSignoff: true }), words).decisions[1]).toBe('Sign-off: waiting for the safety officer.');
  });

  it("carries the work's report, but never the agent's own instructions", () => {
    const v = caseReportView(detail(), words);
    expect(v.work).toEqual({ done: ['Recorded the accident involving contract lineman Ramesh.'], pending: [], attention: [], people: ['Suresh (Shift engineer): 1 call, done'] });
    expect(JSON.stringify(v)).not.toContain('Do what this request needs');
  });
});

describe('caseReportText', () => {
  it('is the whole report as plain text, ready to paste, with no ids', () => {
    const text = caseReportText(caseReportView(detail(), words), 'Kamalpur Power');
    expect(text.split('\n').slice(0, 3)).toEqual(['Kamalpur Power · Job report', 'JOB-0001 · Lineman shock on Kamalpur feeder', 'Closed · Raised 2026-10-14 08:00 · finished 2026-10-14 08:03 · on time']);
    for (const heading of ['Details', 'Stages', 'Decisions', 'What was done', 'People involved']) expect(text).toContain(`\n${heading}\n`);
    expect(text).toContain('1. Job raised · Done · under a minute');
    expect(text).toContain('- Priority: P1 · Critical');
    expect(text).toContain('✓ Recorded the accident involving contract lineman Ramesh.');
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(text).not.toContain('Still in progress'); // empty sections are left out
  });
});

describe('goalTitle', () => {
  it("names a case's work by the case's code and title, never the agents' instructions", () => {
    const text = 'JOB-0001 · Lineman shock\nJob: Accident or near miss (P1, high risk) for Safety.\nDo what this job needs. Look up the company’s playbooks for this kind of work and follow them.';
    expect(goalTitle({ caseId: 'c1', text })).toBe('JOB-0001 · Lineman shock');
  });

  it('keeps a goal someone typed as it is', () => {
    expect(goalTitle({ caseId: null, text: 'Collect the pending invoice payments from Sharma Traders by Friday' })).toBe('Collect the pending invoice payments from Sharma Traders by Friday');
  });
});
