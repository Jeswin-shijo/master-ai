import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { LifecycleSchema, type Pack, type ResolvedPack } from '@onehuman/schemas';
import {
  applyPackUpdates,
  extractAmountInr,
  extractPhone,
  hasDate,
  lifecyclePolicies,
  mergeLifecycles,
  offlineAssign,
  offlineClassify,
  offlineRequest,
  offlineReview,
  packUpdates,
  parsePack,
  resolvePack,
  validatePackRefs,
  workAgents,
} from './index';

/** Tests pinning the findings of the Plan 1 whole-branch review. */

const PACKS_DIR = join(__dirname, '../../../packs');
const registry = new Map<string, Pack>();
for (const dir of readdirSync(PACKS_DIR)) {
  const file = join(PACKS_DIR, dir, 'pack.yaml');
  if (existsSync(file)) {
    const p = parsePack(parse(readFileSync(file, 'utf8')));
    registry.set(p.id, p);
  }
}
const lookup = (id: string) => registry.get(id);
const core = resolvePack(registry.get('core-business')!, lookup);

describe('amounts in everyday Indian notation', () => {
  it.each([
    ['Disburse ₹1.5L to Ravi', 150000],
    ['quote ₹45L for the shed', 4500000],
    ['budget 15L', 1500000],
    ['project ₹2Cr', 20000000],
    ['Rs1.5 lakh top-up', 150000],
    ['Rs1.5cr facility', 15000000],
    ['loan of 1,50,000 for the shop', 150000],
    ['fees 75,000/- pending', 75000],
    ['Rupees 75,000 only', 75000],
    ['₹ 2,00,000/- advance', 200000],
    ['Loan of 1 lakh 20 thousand needed', 120000],
    ['Project cost 2 crore 50 lakh', 25000000],
  ])('reads %s', (text, amount) => {
    expect(extractAmountInr(text)).toBe(amount);
  });

  it('does not read ids or quantities as money', () => {
    expect(extractAmountInr('Invoice 88213 Rs 2,400')).toBe(2400);
    expect(extractAmountInr('Truck did 50k km this year')).toBeNull();
    expect(extractAmountInr('Need 2 lakh bricks and 5 lakh litres of water')).toBeNull();
  });
});

describe('dates and phones in everyday Indian notation', () => {
  it.each(['on the 5th of October', 'by the 15th', 'deliver on 05/10', 'within 3 days', 'by end of the month'])('finds a date in %s', (text) => {
    expect(hasDate(text)).toBe(true);
  });
  it.each([['call 0484 2345678', '0484 2345678'], ['my number 09845012345', '09845012345'], ['office 044-23456789', '044-23456789']])('finds the phone in %s', (text, phone) => {
    expect(extractPhone(text)).toBe(phone);
  });
});

describe('gate rules fail closed', () => {
  const lc = mergeLifecycles([
    LifecycleSchema.parse({
      roles: [{ id: 'credit-manager', name: 'Credit manager', approves: 'Loans' }],
      categories: [{ id: 'loan', name: 'Loan', keywords: ['loan'], priority: 'P3', department: 'Credit', approval: { required: 'above_amount', role: 'credit-manager', amount_inr: 50000 } }],
    }),
  ]);

  it('treats an unknown amount as needing approval for amount rules', () => {
    const rule = lifecyclePolicies(lc).find((r) => r.id === 'lifecycle-loan-approve')!;
    expect(rule.require_approval_above).toEqual({ amount: 50000, currency: 'INR', unknown_needs_approval: true });
  });

  it('sends any case above ₹5 lakh to the owner when no category rule asks first', () => {
    const rule = core.policies.find((p) => p.id === 'case-large-amount')!;
    expect(rule).toMatchObject({ action: 'case.proceed', approver: 'owner', require_approval_above: { amount: 500000 } });
  });
});

describe('lifecycle schemas are strict', () => {
  it('refuses misspelled keys instead of defaulting to no approval', () => {
    expect(() =>
      LifecycleSchema.parse({
        categories: [{ id: 'loan', name: 'Loan', keywords: ['loan'], priority: 'P3', department: 'Credit', aproval: { required: 'always', role: 'owner' } }],
      }),
    ).toThrow(/aproval/);
  });
});

describe('urgent keywords', () => {
  it('lets a pack replace the inherited list', () => {
    const itLifecycle = mergeLifecycles([LifecycleSchema.parse({ urgent_keywords: ['data breach', 'site down'] })]);
    expect(itLifecycle.urgent_keywords).toEqual(['data breach', 'site down']);
    const c = offlineClassify(itLifecycle, offlineRequest({ text: 'Planned outage window for the upgrade', requester: { name: 'Ops' }, source: 'staff', receivedAt: '2026-10-13T06:00:00Z' }), new Date('2026-10-13T06:00:00Z'));
    expect(c.priority).toBe('P3');
  });

  it('keeps the generic list when a pack does not set one', () => {
    expect(mergeLifecycles([LifecycleSchema.parse({})]).urgent_keywords).toContain('fire');
  });
});

describe('assignment ignores filler words', () => {
  it('gives a broken lift to facilities, not to the accountant', () => {
    const lc = mergeLifecycles([
      LifecycleSchema.parse({
        categories: [{ id: 'repair', name: 'Repair and the upkeep', keywords: ['lift', 'broken'], priority: 'P3', department: 'Facilities' }],
      }),
    ]);
    const c = offlineClassify(lc, offlineRequest({ text: 'The lift is broken', requester: { name: 'Front desk' }, source: 'staff', receivedAt: '2026-10-13T06:00:00Z' }), new Date('2026-10-13T06:00:00Z'));
    const a = offlineAssign(lc, c, [
      { id: 'acc', name: 'Lakshmi', title: 'Accountant', responsibilities: ['accounts and the tax filings'] },
      { id: 'fac', name: 'Joseph', title: 'Facilities supervisor', responsibilities: ['lifts'] },
    ]);
    expect(a.assignee?.name).toBe('Joseph');
  });
});

describe('not-eligible rules with words and an amount', () => {
  it('needs both to match', () => {
    const lc = mergeLifecycles([
      LifecycleSchema.parse({
        categories: [{
          id: 'purchase', name: 'Purchase', keywords: ['purchase'], priority: 'P4', department: 'Stores',
          not_eligible: [{ keywords: ['personal'], amount_above_inr: 100000, reason: 'Personal purchases above ₹1 lakh are not allowed.' }],
        }],
      }),
    ]);
    const req = (text: string) => offlineRequest({ text, requester: { name: 'Staff' }, source: 'staff', receivedAt: '2026-10-13T06:00:00Z' });
    expect(offlineReview(lc, req('Purchase a personal laptop bag for ₹2,000')).outcome).not.toBe('not_eligible');
    expect(offlineReview(lc, req('Purchase a ₹5 lakh machine for the plant')).outcome).not.toBe('not_eligible');
    expect(offlineReview(lc, req('Purchase a personal car for ₹6 lakh')).outcome).toBe('not_eligible');
  });
});

describe('pack validation protects the gates', () => {
  it('refuses aliases over gate tools', () => {
    const bad: ResolvedPack = { ...core, tools: [...core.tools, { name: 'loan.sanction', description: 'Sanction', uses: 'case.proceed' }] };
    expect(validatePackRefs(bad)).toContain('tool loan.sanction: case gates cannot be aliased');
  });

  it('refuses approvers that are not lifecycle roles', () => {
    const bad: ResolvedPack = { ...core, policies: [...core.policies, { id: 'cfo-refunds', action: 'refund.issue', require_approval: true, approver: 'cfo' }] };
    expect(validatePackRefs(bad)).toContain('policy cfo-refunds: unknown approver role cfo');
  });

  it('refuses `when` on ordinary actions', () => {
    const bad: ResolvedPack = { ...core, policies: [...core.policies, { id: 'odd', action: 'refund.issue', require_approval: true, approver: 'owner', when: { priority: ['P1'] } }] };
    expect(validatePackRefs(bad)).toContain('policy odd: `when` only applies to case gates');
  });

  it('keeps the case coordinator out of workflow steps and goal planning', () => {
    const bad: ResolvedPack = {
      ...core,
      workflows: [...core.workflows, { id: 'sneaky', name: 'Sneaky', description: 'x', keywords: [], steps: [{ key: 'close', title: 'Close', agent: 'case-coordinator', depends_on: [], instructions: 'Close it' }] }],
    };
    expect(validatePackRefs(bad)).toContain('workflow sneaky.close: the case coordinator runs case stages, not workflow steps');
    expect(workAgents(core).map((a) => a.role)).not.toContain('case-coordinator');
  });
});

describe('lifecycle updates for older workspaces', () => {
  it('leave out categories whose workflow cannot be added', () => {
    const plant = parsePack({
      id: 'plant-upd', version: '1.0.0', name: 'Plant', description: 'Test', extends: ['core-business'],
      workflows: [{ id: 'fix-it', name: 'Fix it', description: 'Fix it', steps: [{ key: 'fix', title: 'Fix', agent: 'ghost-agent', instructions: 'Fix it' }] }],
      lifecycle: { categories: [{ id: 'breakdown', name: 'Breakdown', keywords: ['breakdown'], priority: 'P1', department: 'Maintenance', workflow: 'fix-it' }] },
    });
    const latest = resolvePack(plant, lookup);
    const { lifecycle: _drop, ...rest } = latest;
    const old = { ...rest, workflows: rest.workflows.filter((w) => w.id !== 'fix-it') } as ResolvedPack;
    const updates = packUpdates(old, latest);
    expect(updates.lifecycle.whole!.categories.map((c) => c.id)).not.toContain('breakdown');
    expect(validatePackRefs(applyPackUpdates(old, updates))).toEqual([]);
  });
});
