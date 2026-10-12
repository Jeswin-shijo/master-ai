import { describe, expect, it } from 'vitest';
import { CaseFileSchema, LifecycleSchema, PackSchema, PolicyRuleSchema, SECTORS, STAGE_KEYS } from '@onehuman/schemas';

const category = {
  id: 'breakdown',
  name: 'Breakdown repair',
  keywords: ['breakdown', 'vibration'],
  priority: 'P1',
  department: 'Maintenance',
  approval: { required: 'high_risk_or_p1', role: 'safety-officer' },
  signoff: { required: true, role: 'maintenance-head' },
};

describe('lifecycle schemas', () => {
  it('lists eight stages and five sectors in order', () => {
    expect(STAGE_KEYS).toEqual(['request', 'review', 'classify', 'assign', 'approve', 'execute', 'close', 'report']);
    expect(SECTORS.map((s) => s.name)).toEqual([
      'Energy & Heavy Industry',
      'Trade, Logistics & Tourism',
      'Finance & Development',
      'Technology & Innovation',
      'Essential Public & Service',
    ]);
  });

  it('parses a partial lifecycle and fills defaults', () => {
    const lc = LifecycleSchema.parse({
      case: { label: 'Work order', plural: 'Work orders', prefix: 'WO' },
      stages: { approve: { name: 'Safety (HSE) approval' } },
      categories: [category],
    });
    expect(lc.categories[0]!.risk).toBe('medium');
    expect(lc.categories[0]!.required_details).toEqual([]);
    expect(lc.priorities).toEqual([]);
  });

  it('rejects a bad case prefix, an approval without a role and above_amount without an amount', () => {
    expect(() => LifecycleSchema.parse({ case: { label: 'X', plural: 'Xs', prefix: 'wo' } })).toThrow();
    expect(() => LifecycleSchema.parse({ categories: [{ ...category, approval: { required: 'always' } }] })).toThrow(/role/);
    expect(() =>
      LifecycleSchema.parse({ categories: [{ ...category, approval: { required: 'above_amount', role: 'owner' } }] }),
    ).toThrow(/amount_inr/);
  });

  it('accepts sector and lifecycle on a pack, and `when` on a policy rule', () => {
    const pack = PackSchema.parse({
      id: 'power-plant',
      version: '1.0.0',
      name: 'Power plant',
      description: 'Generation and distribution',
      sector: 'energy-heavy-industry',
      lifecycle: { categories: [category] },
    });
    expect(pack.sector).toBe('energy-heavy-industry');
    const rule = PolicyRuleSchema.parse({
      action: 'case.proceed',
      require_approval: true,
      approver: 'safety-officer',
      when: { category: ['breakdown'], priority: ['P1'] },
    });
    expect(rule.when?.priority).toEqual(['P1']);
  });

  it('validates a case file part by part', () => {
    const file = CaseFileSchema.parse({
      classify: {
        category: 'breakdown',
        categoryName: 'Breakdown repair',
        priority: 'P1',
        risk: 'high',
        department: 'Maintenance',
        amountInr: null,
        respondBy: '2026-10-13T07:12:00.000Z',
        resolveBy: '2026-10-13T10:12:00.000Z',
        reasons: ['Matched “vibration”'],
      },
    });
    expect(file.classify?.priority).toBe('P1');
    expect(() => CaseFileSchema.parse({ classify: { category: 'x' } })).toThrow();
  });
});
