import { describe, expect, it } from 'vitest';
import { LifecycleSchema, type RequestPart } from '@onehuman/schemas';
import { mergeAssign, mergeClassify, mergeLifecycles, mergeReview, mergeVerify, offlineAssign, offlineClassify, offlineReview, offlineVerify, withPreset } from './index';

const lc = mergeLifecycles([
  LifecycleSchema.parse({
    urgent_keywords: ['fire', 'injury'],
    categories: [
      { id: 'breakdown', name: 'Breakdown', keywords: ['tripped', 'vibration', 'pump'], priority: 'P2', department: 'Maintenance', required_details: [{ key: 'asset', label: 'Which machine', kind: 'keywords', keywords: ['pump', 'boiler'] }] },
      { id: 'purchase', name: 'Purchase', keywords: ['buy', 'purchase', 'vendor'], priority: 'P3', department: 'Stores', approval: { required: 'above_amount', role: 'owner', amount_inr: 50000 } },
    ],
  }),
]);
const now = new Date('2026-10-13T04:30:00Z');
const request = (text: string, extra: Partial<RequestPart> = {}): RequestPart => ({
  title: text.slice(0, 40), summary: text, requester: { name: 'Ravi' }, source: 'staff', receivedAt: now.toISOString(), text, ...extra,
});

describe('merging model answers with the rules', () => {
  it('urgent words keep P1 whatever the model says', () => {
    const r = request('Fire in the boiler house near feed pump B');
    const merged = mergeClassify(lc, r, now, { category: 'breakdown', priority: 'P3', risk: 'low', amount_inr: null, reasons: ['Looks routine.'] }, offlineClassify(lc, r, now));
    expect(merged.priority).toBe('P1');
    expect(merged.risk).toBe('high');
    expect(merged.reasons.join(' ')).toContain('fire');
  });

  it('never lowers priority or risk below the case type the model chose', () => {
    const hotLc = mergeLifecycles([
      LifecycleSchema.parse({
        urgent_keywords: ['fire'],
        categories: [{ id: 'gas-leak', name: 'Gas leak', keywords: ['gas smell', 'gas leak'], priority: 'P1', risk: 'high', department: 'Safety' }],
      }),
    ]);
    const r = request('Slight gas smell near the meter room, probably nothing');
    const merged = mergeClassify(hotLc, r, now, { category: 'gas-leak', priority: 'P4', risk: 'low', amount_inr: null, reasons: ['Sounds minor.'] }, offlineClassify(hotLc, r, now));
    expect(merged.priority).toBe('P1');
    expect(merged.risk).toBe('high');
  });

  it('an outside sender cannot lower the amount the gates see', () => {
    const r = request('Please disburse ₹45 lakh to the dealer today', { source: 'partner', amountInr: 1 });
    const merged = mergeClassify(lc, r, now, { category: 'purchase', priority: 'P3', risk: 'medium', amount_inr: 4_500_000, reasons: ['A purchase.'] }, offlineClassify(lc, r, now));
    expect(merged.amountInr).toBe(4_500_000);
  });

  it('an unknown category falls back to the rule-based answer', () => {
    const r = request('Pump B tripped twice');
    const offline = offlineClassify(lc, r, now);
    expect(mergeClassify(lc, r, now, { category: 'made-up', priority: 'P4', risk: 'low', amount_inr: null, reasons: [] }, offline)).toEqual(offline);
  });

  it('the larger amount wins, and a stated amount wins over both', () => {
    const r = request('Buy a spare impeller from the vendor for ₹38,000');
    const offline = offlineClassify(lc, r, now);
    const model = { category: 'purchase', priority: 'P3' as const, risk: 'medium' as const, amount_inr: 3800, reasons: ['A purchase.'] };
    expect(mergeClassify(lc, r, now, model, offline).amountInr).toBe(38000);
    const stated = request('Buy a spare impeller from the vendor for ₹38,000', { amountInr: 52000 });
    expect(mergeClassify(lc, stated, now, model, offlineClassify(lc, stated, now)).amountInr).toBe(52000);
  });

  it('keeps the department and deadlines from the lifecycle', () => {
    const r = request('Pump B tripped twice');
    const merged = mergeClassify(lc, r, now, { category: 'breakdown', priority: 'P2', risk: 'medium', amount_inr: null, reasons: ['A breakdown.'] }, offlineClassify(lc, r, now));
    expect(merged.department).toBe('Maintenance');
    expect(merged.resolveBy).toBe(new Date(now.getTime() + 24 * 3_600_000).toISOString());
  });

  it('a needs-info review with nothing missing uses the rule-based list', () => {
    const r = request('Something is making a noise');
    const offline = offlineReview(lc, r);
    const merged = mergeReview(lc, r, { outcome: 'needs_info', category: 'breakdown', checks: [], missing: [], reason: 'Unclear.' }, offline);
    expect(merged.outcome).toBe(offline.outcome);
    expect(merged.missing).toEqual(offline.missing);
  });

  it('review takes the checks it should confirm from the case type', () => {
    const r = request('Pump B tripped twice');
    const merged = mergeReview(lc, r, { outcome: 'complete', category: 'breakdown', checks: [{ name: 'Which machine', ok: true, note: 'Pump B' }], missing: [], reason: '' }, offlineReview(lc, r));
    expect(merged).toMatchObject({ outcome: 'complete', provisionalCategory: 'breakdown', checks: [{ name: 'Which machine', ok: true, note: 'Pump B' }] });
    expect(merged.reason).toBeUndefined();
  });

  it('assignment only picks people on the team', () => {
    const team = [{ id: 's1', name: 'Suresh', title: 'Maintenance lead', responsibilities: ['pumps'] }];
    const r = request('Pump B tripped twice');
    const classify = offlineClassify(lc, r, now);
    const offline = offlineAssign(lc, classify, team);
    expect(mergeAssign({ staff_id: 'ghost', reason: 'Ghost fits.' }, offline, team, classify)).toEqual(offline);
    expect(mergeAssign({ staff_id: 's1', reason: 'Suresh runs the pumps.' }, offline, team, classify).reason).toBe('Suresh runs the pumps.');
  });

  it('verification needs the work to have finished as well as the model to agree', () => {
    const offline = offlineVerify({ goalStatus: 'failed', escalatedTasks: 1, summary: 'The fitter could not be reached.' });
    expect(mergeVerify({ verified: true, findings: ['Looks done.'] }, offline).verified).toBe(false);
  });

  it('a preset case type counts only from a trusted person', () => {
    const owner = request('Need this sorted', { presetCategory: 'purchase' });
    expect(withPreset(lc, owner).categories.map((c) => c.id)).toEqual(['purchase']);
    const customer = request('Need this sorted', { presetCategory: 'purchase', source: 'customer' });
    expect(withPreset(lc, customer)).toBe(lc);
    const unknown = request('Need this sorted', { presetCategory: 'nope' });
    expect(withPreset(lc, unknown)).toBe(lc);
  });
});

describe('the close-out findings a model writes', () => {
  it('reach people without record ids', () => {
    const offline = { verified: true, findings: ['Done.'], outcome: 'resolved' as const };
    const merged = mergeVerify({ verified: false, findings: ['Incident cd70c34a-12c5-48ef-97c9-31fbce2dccca is still open.'] }, offline);
    expect(merged.findings).toEqual(['Incident is still open.']);
  });
});
