import { describe, expect, it } from 'vitest';
import type { ResolvedLifecycle } from '@onehuman/schemas';
import { mergeLifecycles, matchCategory, offlineAssign, offlineClassify, offlineReport, offlineRequest, offlineReview, offlineVerify } from './index';

const lc: ResolvedLifecycle = mergeLifecycles([
  {
    case: { label: 'Work order', plural: 'Work orders', prefix: 'WO' },
    stages: {},
    priorities: [],
    roles: [{ id: 'safety-officer', name: 'Safety officer', approves: 'Permits' }],
    urgent_keywords: ['smoke'],
    categories: [
      { id: 'breakdown', name: 'Breakdown repair', keywords: ['breakdown', 'vibration', 'not working', 'tripped'], priority: 'P2', risk: 'high', department: 'Maintenance',
        required_details: [{ key: 'asset', label: 'Which equipment', kind: 'keywords', keywords: ['pump', 'boiler', 'turbine', 'conveyor'] }],
        required_checks: ['Isolation confirmed'], not_eligible: [], approval: { required: 'high_risk_or_p1', role: 'safety-officer' }, signoff: { required: false }, execution: 'team' },
      { id: 'spares', name: 'Spares purchase', keywords: ['spares', 'purchase', 'buy'], priority: 'P4', risk: 'low', department: 'Stores',
        required_details: [{ key: 'amount', label: 'Estimated cost', kind: 'amount' }], required_checks: [],
        not_eligible: [{ keywords: ['personal use'], reason: 'Company money cannot buy things for personal use.' }, { keywords: [], amount_above_inr: 5000000, reason: 'Purchases above ₹50 lakh go through a tender.' }],
        approval: { required: 'above_amount', role: 'owner', amount_inr: 50000 }, signoff: { required: false }, execution: 'agents' },
    ],
    examples: [],
  },
]);

const request = (text: string) =>
  offlineRequest({ text, requester: { name: 'Control room' }, source: 'system', receivedAt: '2026-10-13T06:12:00.000Z' });

describe('offline stages', () => {
  it('writes a short title and keeps the full text', () => {
    const r = request('Boiler feed pump B vibrating above limit. Vibration is 11 mm/s and rising since the night shift started, please send someone before it trips the unit.');
    expect(r.title).toBe('Boiler feed pump B vibrating above limit.');
    expect(r.text).toContain('night shift');
  });

  it('matches the category with the strongest keywords', () => {
    expect(matchCategory(lc, 'Pump B vibration, now not working')!.category.id).toBe('breakdown');
    expect(matchCategory(lc, 'please buy spares for the conveyor')!.category.id).toBe('spares');
  });

  it('falls back when nothing matches', () => {
    expect(matchCategory(lc, 'Canteen menu feedback')).toBeNull();
    const c = offlineClassify(lc, request('Canteen menu feedback'), new Date('2026-10-13T06:12:00Z'));
    expect(c.category).toBe('general');
    expect(c.reasons[0]).toMatch(/No category matched/);
  });

  it('asks for missing details', () => {
    const review = offlineReview(lc, request('Strong vibration near bay 4, please check'));
    expect(review.outcome).toBe('needs_info');
    expect(review.missing).toEqual([{ key: 'asset', label: 'Which equipment' }]);
    expect(review.toConfirm).toEqual(['Isolation confirmed']);
  });

  it('marks requests that are not eligible', () => {
    const personal = offlineReview(lc, request('Please purchase a TV for personal use, about ₹40,000'));
    expect(personal.outcome).toBe('not_eligible');
    expect(personal.reason).toBe('Company money cannot buy things for personal use.');
    const huge = offlineReview(lc, request('Purchase new turbine spares worth 6 crore'));
    expect(huge.outcome).toBe('not_eligible');
  });

  it('passes complete requests', () => {
    expect(offlineReview(lc, request('Boiler feed pump B vibration above limit')).outcome).toBe('complete');
  });

  it('sets priority, risk, department and deadlines', () => {
    const c = offlineClassify(lc, request('Boiler feed pump B vibration above limit'), new Date('2026-10-13T06:12:00Z'));
    expect(c).toMatchObject({ category: 'breakdown', categoryName: 'Breakdown repair', priority: 'P2', risk: 'high', department: 'Maintenance', amountInr: null });
    expect(c.respondBy).toBe('2026-10-13T10:12:00.000Z');
    expect(c.resolveBy).toBe('2026-10-14T06:12:00.000Z');
  });

  it('raises urgent requests to P1 and high risk', () => {
    const c = offlineClassify(lc, request('Smoke coming from conveyor 3 motor, breakdown'), new Date('2026-10-13T06:12:00Z'));
    expect(c.priority).toBe('P1');
    expect(c.risk).toBe('high');
    expect(c.reasons.join(' ')).toMatch(/smoke/);
  });

  it('uses a given amount before extracting one', () => {
    expect(offlineClassify(lc, request('buy spares'), new Date(), 75000).amountInr).toBe(75000);
    expect(offlineClassify(lc, request('buy spares for ₹1.2 lakh'), new Date()).amountInr).toBe(120000);
  });

  it('assigns the best-placed person, or the department when nobody fits', () => {
    const c = offlineClassify(lc, request('Boiler feed pump vibration'), new Date('2026-10-13T06:12:00Z'));
    const team = [
      { id: 's1', name: 'Ravi Kumar', title: 'Mechanical supervisor', responsibilities: ['maintenance', 'pumps', 'breakdown repairs'] },
      { id: 's2', name: 'Meera Iyer', title: 'Stores officer', responsibilities: ['spares', 'purchase'] },
    ];
    const a = offlineAssign(lc, c, team);
    expect(a.assignee).toEqual({ staffId: 's1', name: 'Ravi Kumar', title: 'Mechanical supervisor' });
    expect(a.deadline).toBe(c.resolveBy);
    const stores = [team[1]!, { id: 's3', name: 'Joseph D', title: 'Accounts clerk', responsibilities: ['billing'] }];
    const none = offlineAssign(lc, c, stores);
    expect(none.assignee).toBeNull();
    expect(none.team).toBe('Maintenance');
    expect(none.reason).toBe('Nobody on the team covers maintenance yet, so it is with the Maintenance team.');
    const solo = offlineAssign(lc, c, [{ id: 's9', name: 'Owner', title: 'Owner', responsibilities: [] }]);
    expect(solo.assignee?.name).toBe('Owner');
  });

  it('verifies from the work outcome', () => {
    expect(offlineVerify({ goalStatus: 'completed', escalatedTasks: 0, summary: 'Replaced the bearing.' })).toEqual({ verified: true, findings: ['Replaced the bearing.'], outcome: 'resolved' });
    expect(offlineVerify({ goalStatus: 'partially_completed', escalatedTasks: 1, summary: 'Bearing on order.' }).outcome).toBe('not_resolved');
  });

  it('reports time per stage, the SLA and recurring problems', () => {
    const report = offlineReport({
      caseLabel: 'Work order', number: 'WO-0042', title: 'Boiler feed pump B vibrating above limit', categoryName: 'Breakdown repair', outcome: 'resolved',
      createdAt: '2026-10-13T06:12:00.000Z', resolveBy: '2026-10-13T10:12:00.000Z', closedAt: '2026-10-13T09:32:00.000Z', sameCategoryLast30Days: 3,
      stages: [
        { key: 'request', name: 'Work order raised', status: 'done', startedAt: '2026-10-13T06:12:00.000Z', completedAt: '2026-10-13T06:12:30.000Z' },
        { key: 'execute', name: 'Work under permit', status: 'done', startedAt: '2026-10-13T07:00:00.000Z', completedAt: '2026-10-13T09:20:00.000Z' },
        { key: 'approve', name: 'Safety (HSE) approval', status: 'skipped' },
      ],
    });
    expect(report.slaMet).toBe(true);
    expect(report.minutesPerStage).toEqual([{ stage: 'request', minutes: 1 }, { stage: 'execute', minutes: 140 }]);
    expect(report.recurring).toEqual({ count: 3, note: '3 breakdown repairs in the last 30 days. Worth looking for a root cause.' });
    expect(report.text).toBe('WO-0042 Boiler feed pump B vibrating above limit was resolved in 3 h 20 min, inside its 4 h target. 3 breakdown repairs in the last 30 days. Worth looking for a root cause.');
  });
});
