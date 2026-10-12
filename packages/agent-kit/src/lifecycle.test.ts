import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { CaseFileSchema, LifecycleSchema, PackSchema, PolicyRuleSchema, SECTORS, STAGE_KEYS, type Pack, type ResolvedPack } from '@onehuman/schemas';
import {
  applyPackUpdates,
  countPackUpdates,
  emptyPackUpdates,
  GENERIC_LIFECYCLE,
  lifecycleOf,
  lifecyclePolicies,
  mergeLifecycles,
  packUpdates,
  parsePack,
  resolvePack,
  validatePackRefs,
} from './index';

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

const plant = parsePack({
  id: 'plant-test', version: '1.0.0', name: 'Plant', description: 'Test plant', extends: ['core-business'],
  sector: 'energy-heavy-industry',
  workflows: [{ id: 'fix-it', name: 'Fix it', description: 'Fix it', steps: [{ key: 'fix', title: 'Fix', agent: 'work-coordinator', instructions: 'Fix it' }] }],
  lifecycle: {
    case: { label: 'Work order', plural: 'Work orders', prefix: 'WO' },
    stages: { approve: { name: 'Safety (HSE) approval' }, close: { name: 'Inspection & handover', checks: ['Area cleaned'] } },
    roles: [{ id: 'safety-officer', name: 'Safety officer', approves: 'Hot work permits' }, { id: 'maintenance-head', name: 'Maintenance head', approves: 'Repairs' }],
    urgent_keywords: ['fire'],
    categories: [
      { id: 'breakdown', name: 'Breakdown repair', keywords: ['breakdown', 'vibration'], priority: 'P1', risk: 'high', department: 'Maintenance', workflow: 'fix-it',
        approval: { required: 'high_risk_or_p1', role: 'safety-officer' }, signoff: { required: true, role: 'maintenance-head' } },
      { id: 'spares', name: 'Spares purchase', keywords: ['spares', 'purchase'], priority: 'P4', department: 'Stores',
        approval: { required: 'above_amount', role: 'owner', amount_inr: 50000 } },
    ],
  },
});

describe('lifecycle resolution', () => {
  it('starts from the generic lifecycle', () => {
    expect(GENERIC_LIFECYCLE.stages.map((s) => s.name)).toEqual([
      'Request / Event Created', 'Admin Review & Validation', 'Classification & Priority', 'Assignment',
      'Approval Gate', 'Execution & Monitoring', 'Verification & Closure', 'Reporting & Continuous Improvement',
    ]);
    expect(mergeLifecycles([])).toEqual(GENERIC_LIFECYCLE);
  });

  it('gives every registry pack a complete lifecycle', () => {
    for (const p of registry.values()) {
      const lc = resolvePack(p, lookup).lifecycle!;
      expect(lc.stages).toHaveLength(8);
      expect(lc.priorities.map((x) => x.id)).toEqual(['P1', 'P2', 'P3', 'P4']);
      expect(lc.roles.some((r) => r.id === 'owner')).toBe(true);
    }
  });

  it('overrides stage names per stage and keeps inherited descriptions', () => {
    const lc = resolvePack(plant, lookup).lifecycle!;
    expect(lc.case.prefix).toBe('WO');
    const approve = lc.stages.find((s) => s.key === 'approve')!;
    expect(approve.name).toBe('Safety (HSE) approval');
    expect(approve.description).toBe(GENERIC_LIFECYCLE.stages[4]!.description);
    expect(lc.stages.find((s) => s.key === 'close')!.checks).toEqual(['Area cleaned']);
    expect(lc.stages.find((s) => s.key === 'request')!.name).toBe('Request / Event Created');
    expect(lc.categories.map((c) => c.id)).toEqual(['general', 'breakdown', 'spares']);
  });

  it('inherits the sector', () => {
    const child = parsePack({ id: 'child', version: '1.0.0', name: 'Child', description: 'c', extends: ['plant-test'] });
    registry.set('plant-test', plant);
    expect(resolvePack(child, lookup).sector).toBe('energy-heavy-industry');
    registry.delete('plant-test');
  });

  it('derives gate policies from category rules', () => {
    const lc = resolvePack(plant, lookup).lifecycle!;
    const rules = lifecyclePolicies(lc);
    expect(rules.map((r) => r.id)).toEqual([
      'lifecycle-breakdown-approve-p1', 'lifecycle-breakdown-approve-high-risk', 'lifecycle-breakdown-signoff', 'lifecycle-spares-approve',
    ]);
    expect(rules[0]).toMatchObject({ action: 'case.proceed', approver: 'safety-officer', require_approval: true, when: { category: ['breakdown'], priority: ['P1'] } });
    expect(rules[2]).toMatchObject({ action: 'case.close', approver: 'maintenance-head' });
    expect(rules[3]).toMatchObject({ require_approval_above: { amount: 50000, currency: 'INR' } });
    expect(rules[0]!.reason).toBe('Breakdown repair: P1 cases need approval by the safety officer');
  });

  it('adds derived policies when resolving and validates cleanly', () => {
    const resolved = resolvePack(plant, lookup);
    expect(resolved.policies.some((p) => p.id === 'lifecycle-breakdown-signoff')).toBe(true);
    expect(validatePackRefs(resolved)).toEqual([]);
  });

  it('names missing roles and workflows', () => {
    const resolved = resolvePack(plant, lookup);
    const broken: ResolvedPack = {
      ...resolved,
      lifecycle: {
        ...resolved.lifecycle!,
        categories: resolved.lifecycle!.categories.map((c) => (c.id === 'breakdown' ? { ...c, workflow: 'nope', approval: { required: 'always' as const, role: 'ghost' } } : c)),
      },
    };
    expect(validatePackRefs(broken)).toEqual(expect.arrayContaining([
      'lifecycle category breakdown: unknown workflow nope',
      'lifecycle category breakdown: unknown approval role ghost',
    ]));
  });

  it('reads a generic lifecycle from workspaces installed before lifecycles', () => {
    const { lifecycle: _drop, ...old } = resolvePack(registry.get('travel-agency')!, lookup);
    expect(lifecycleOf(old as ResolvedPack)).toEqual(GENERIC_LIFECYCLE);
  });

  it('offers the lifecycle and the coordinator to older workspaces, and only adds', () => {
    const latest = resolvePack(registry.get('travel-agency')!, lookup);
    const { lifecycle: _drop, ...rest } = latest;
    const old = { ...rest, agents: rest.agents.filter((a) => a.role !== 'case-coordinator') } as ResolvedPack;
    const updates = packUpdates(old, latest);
    expect(updates.lifecycle.whole).toEqual(latest.lifecycle);
    expect(updates.agents.map((a) => a.role)).toContain('case-coordinator');
    expect(countPackUpdates(updates)).toBeGreaterThan(1);
    const applied = applyPackUpdates(old, updates);
    expect(applied.lifecycle).toEqual(latest.lifecycle);
    expect(validatePackRefs(applied)).toEqual([]);
    expect(countPackUpdates(packUpdates(applied, latest))).toBe(0);
    expect(countPackUpdates(emptyPackUpdates())).toBe(0);
  });
});
