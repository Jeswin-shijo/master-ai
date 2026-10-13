import { describe, expect, it } from 'vitest';
import type { Case, CaseStageStatus } from '@onehuman/schemas';
import { caseMatches, dotLabel, dotsFromCase, dotsFromStages, dueWords, GENERIC_STAGE_NAMES, homeBuckets, listScope, showStageSummary, stageNames } from './cases';

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

describe('due times in words', () => {
  const now = new Date('2026-10-13T10:00:00Z');

  it('says how long is left, or how late it is', () => {
    expect(dueWords('2026-10-13T20:00:00Z', now)).toEqual({ text: 'Due in 10 hours', late: false });
    expect(dueWords('2026-10-13T10:20:00Z', now)).toEqual({ text: 'Due in less than an hour', late: false });
    expect(dueWords('2026-10-11T10:00:00Z', now)).toEqual({ text: 'Overdue by 2 days', late: true });
    expect(dueWords(null, now)).toBeNull();
  });
});

describe('a refused approval', () => {
  const stages = (['done', 'done', 'done', 'done', 'done', 'skipped', 'skipped', 'done'] as CaseStageStatus[]).map((status) => ({ status }));

  it('shows the approval stage as stopped, not done', () => {
    expect(dotsFromStages(stages, { approveDecision: 'rejected' })[4]).toBe('stopped');
    expect(dotsFromStages(stages, { approveDecision: 'expired' })[4]).toBe('stopped');
    expect(dotsFromStages(stages, { approveDecision: 'blocked' })[4]).toBe('stopped');
    expect(dotsFromStages(stages, { approveDecision: 'approved' })[4]).toBe('done');
  });
});

describe('the case file timeline', () => {
  it('reads a finished stage from its sentences, and keeps the summary as the live line until then', () => {
    expect(showStageSummary('done', 3)).toBe(false);
    expect(showStageSummary('skipped', 1)).toBe(false);
    expect(showStageSummary('done', 0)).toBe(true);
    expect(showStageSummary('waiting', 2)).toBe(true);
    expect(showStageSummary('stopped', 2)).toBe(true);
  });
});

describe('which cases the list loads', () => {
  it('loads every open case for the open and waiting tabs, and the newest cases otherwise', () => {
    expect(listScope('open')).toBe('open');
    expect(listScope('waiting')).toBe('open');
    expect(listScope('closed')).toBe('all');
    expect(listScope('')).toBe('all');
  });
});
