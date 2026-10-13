import { describe, expect, it } from 'vitest';
import type { CaseFile } from '@onehuman/schemas';
import { caseFileLines } from './case-file';

const when = (iso: string) => iso.slice(0, 10);
const roleName = (id: string) => ({ 'safety-officer': 'the safety officer', owner: 'the owner' })[id] ?? 'the right person';

const file: CaseFile = {
  request: {
    title: 'Hot work permit',
    summary: 'Welding of chute liner plates at Conveyor 3B tomorrow.',
    requester: { name: 'Shree Fabricators' },
    source: 'partner',
    receivedAt: '2026-10-13T04:30:00Z',
    text: 'M/s Shree Fabricators: we will start welding tomorrow.',
    amountInr: 45000,
  },
  review: {
    outcome: 'needs_info',
    provisionalCategory: null,
    checks: [
      { name: 'Place given', ok: true },
      { name: 'Crew size', ok: false, note: 'not stated' },
    ],
    missing: [{ key: 'area', label: 'which area' }],
    toConfirm: ['Fire watch arranged'],
  },
  classify: {
    category: 'high-risk-permit',
    categoryName: 'High-risk permit',
    priority: 'P2',
    risk: 'high',
    department: 'Safety',
    amountInr: null,
    respondBy: '2026-10-13T08:30:00Z',
    resolveBy: '2026-10-14T04:30:00Z',
    reasons: ['Welding is hot work.'],
  },
  assign: { assignee: { name: 'Suresh', title: 'Shift engineer' }, team: 'Maintenance', deadline: '2026-10-14T04:30:00Z', reason: 'Suresh runs the conveyor area.' },
  approve: { required: true, approverRole: 'safety-officer', decision: 'approved', decidedBy: 'Sunita', notes: 'Permit HW-118 issued' },
  execute: { goalId: 'g1', status: 'completed', summary: 'Permit issued and the crew briefed.', costInr: 0, evidence: ['Permit HW-118 sent to the contractor.'] },
  close: { verified: true, findings: ['Area inspected after work.'], signoff: { required: true, role: 'safety-officer', decision: 'approved', by: 'Sunita' }, outcome: 'resolved' },
  report: { text: 'HW-0007 closed in 1 day.', slaMet: true, minutesPerStage: [], recurring: { count: 3, note: 'Third hot-work request at Conveyor 3B this month.' } },
};

describe('the case file in words', () => {
  const lines = caseFileLines(file, { when, roleName });

  it('says who asked, from where, and what they asked', () => {
    expect(lines.request).toEqual(['Shree Fabricators, from a partner, on 2026-10-13.', 'Welding of chute liner plates at Conveyor 3B tomorrow.', 'Amount given: ₹45,000.']);
  });

  it('says what is missing and what a person must confirm', () => {
    expect(lines.review).toEqual(['Needs: which area.', 'Checked: Place given.', 'Not yet: Crew size (not stated).', 'A person confirms: Fire watch arranged.']);
  });

  it('names the type, deadlines, assignee, approver, sign-off and report in sentences', () => {
    expect(lines.classify?.slice(0, 2)).toEqual(['High-risk permit, P2, high risk, for Safety.', 'Respond by 2026-10-13; resolve by 2026-10-14.']);
    expect(lines.assign?.[0]).toBe('Assigned to Suresh, Shift engineer (Maintenance).');
    expect(lines.approve).toEqual(['Approved by Sunita.', 'Note: Permit HW-118 issued']);
    expect(lines.close).toEqual(['Checked and resolved.', 'Area inspected after work.', 'Signed off by Sunita.']);
    expect(lines.report).toEqual(['HW-0007 closed in 1 day.', 'Finished within the deadline.', 'Third hot-work request at Conveyor 3B this month.']);
  });

  it('uses the role name when no person is named, and never shows keys or JSON', () => {
    const late = caseFileLines({ approve: { required: true, approverRole: 'safety-officer', decision: 'rejected' } }, { when, roleName });
    expect(late.approve).toEqual(['Rejected by the safety officer.']);
    const all = Object.values(lines).flat().join('\n');
    expect(all).not.toMatch(/[{}[\]]|goalId|high-risk-permit|safety-officer/);
  });
});

describe('priority names', () => {
  it('says the priority the way the organization names it', () => {
    const lines = caseFileLines(file, { when, roleName, priorityName: (p) => (p === 'P2' ? 'Urgent' : undefined) });
    expect(lines.classify?.[0]).toBe('High-risk permit, Urgent (P2), high risk, for Safety.');
    expect(caseFileLines(file, { when, roleName, priorityName: () => undefined }).classify?.[0]).toBe('High-risk permit, P2, high risk, for Safety.');
  });
});
