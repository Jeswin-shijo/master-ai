import { describe, expect, it } from 'vitest';
import type { Case } from '@onehuman/schemas';
import { caseMatches, dotLabel, dotsFromCase, dotsFromStages, GENERIC_STAGE_NAMES, homeBuckets, stageNames } from './cases';

const base: Case = {
  id: 'c1', workspaceId: 'w1', number: 42, code: 'WO-0042', title: 'Boiler feed pump B vibration', source: 'staff',
  requester: { name: 'Ravi Kumar' }, category: 'breakdown', categoryName: 'Breakdown', priority: 'P2', risk: 'medium',
  department: 'Maintenance', amountInr: null, assignee: { name: 'Suresh', title: 'Maintenance lead' }, respondBy: null,
  resolveBy: null, stage: 'approve', status: 'waiting_approval', outcome: null, goalId: null,
  createdAt: '2026-10-13T04:30:00Z', updatedAt: '2026-10-13T04:30:00Z', closedAt: null,
};

describe('stage names', () => {
  it('falls back to the generic stage names', () => {
    expect(stageNames(null).approve).toBe('Approval Gate');
    const named = stageNames({ stages: [{ key: 'approve', name: 'Permit & clearance' }] });
    expect(named.approve).toBe('Permit & clearance');
    expect(named.review).toBe(GENERIC_STAGE_NAMES.review);
  });
});

describe('stage dots', () => {
  it('marks earlier stages done and the current one as waiting on a person', () => {
    expect(dotsFromCase(base)).toEqual(['done', 'done', 'done', 'done', 'waiting', 'todo', 'todo', 'todo']);
    expect(dotsFromCase({ ...base, stage: 'execute', status: 'in_progress' })[5]).toBe('live');
  });

  it('shows a closed case all done and a stopped case stopped', () => {
    expect(dotsFromCase({ ...base, stage: 'report', status: 'closed' })).toEqual(Array(8).fill('done'));
    expect(dotsFromCase({ ...base, stage: 'report', status: 'rejected' }).slice(0, 2)).toEqual(['stopped', 'stopped']);
  });

  it('reads the exact state of each stage from the timeline', () => {
    expect(dotsFromStages([{ status: 'done' }, { status: 'skipped' }, { status: 'waiting_approval' }, { status: 'running' }, { status: 'pending' }])).toEqual([
      'done', 'skipped', 'waiting', 'live', 'todo',
    ]);
  });

  it('says not started in words', () => {
    expect(dotLabel('todo')).toBe('Not started');
    expect(dotLabel('waiting')).toBe('Waiting for a person');
  });
});

describe('case filters', () => {
  it('finds a case by number, title or requester, whatever the case of the letters', () => {
    expect(caseMatches(base, { q: 'wo-0042' })).toBe(true);
    expect(caseMatches(base, { q: 'PUMP B' })).toBe(true);
    expect(caseMatches(base, { q: 'ravi' })).toBe(true);
    expect(caseMatches(base, { q: 'conveyor' })).toBe(false);
  });

  it('filters by stage, priority, status group and assignee', () => {
    expect(caseMatches(base, { stage: 'approve', priority: 'P2', status: 'waiting', assignee: 'sure' })).toBe(true);
    expect(caseMatches(base, { status: 'closed' })).toBe(false);
    expect(caseMatches(base, { priority: 'P1' })).toBe(false);
  });
});

describe('home', () => {
  const now = new Date('2026-10-13T10:00:00Z');

  it('counts open cases by stage, lists what waits on people and what is about to miss its deadline', () => {
    const soon = { ...base, id: 'c2', stage: 'execute' as const, status: 'in_progress' as const, resolveBy: '2026-10-13T20:00:00Z' };
    const later = { ...base, id: 'c3', stage: 'execute' as const, status: 'in_progress' as const, resolveBy: '2026-10-20T10:00:00Z' };
    const done = { ...base, id: 'c4', status: 'closed' as const, stage: 'report' as const };
    const b = homeBuckets([base, soon, later, done], now);
    expect(b.open).toBe(3);
    expect(b.byStage.execute).toBe(2);
    expect(b.byStage.approve).toBe(1);
    expect(b.waiting.map((c) => c.id)).toEqual(['c1']);
    expect(b.atRisk.map((c) => c.id)).toEqual(['c2']);
  });
});
