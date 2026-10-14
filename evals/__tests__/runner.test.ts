import { describe, expect, it } from 'vitest';
import { parsePack, resolvePack } from '@onehuman/agent-kit';
import { EvalSuiteSchema, loadPackRegistry, runSuite } from '../src/runner';

const registry = loadPackRegistry(new URL('../../packs', import.meta.url).pathname);
const plant = parsePack({
  id: 'plant-eval', version: '1.0.0', name: 'Plant', description: 'Eval fixture', extends: ['core-business'],
  lifecycle: {
    roles: [{ id: 'safety-officer', name: 'Safety officer', approves: 'Permits' }, { id: 'maintenance-head', name: 'Maintenance head', approves: 'Repairs' }],
    categories: [
      { id: 'breakdown', name: 'Breakdown repair', keywords: ['breakdown', 'vibration', 'tripped'], priority: 'P1', risk: 'high', department: 'Maintenance',
        required_details: [{ key: 'asset', label: 'Which equipment', kind: 'keywords', keywords: ['pump', 'boiler'] }],
        approval: { required: 'high_risk_or_p1', role: 'safety-officer' }, signoff: { required: true, role: 'maintenance-head' } },
      { id: 'spares', name: 'Spares purchase', keywords: ['spares', 'purchase'], priority: 'P4', risk: 'low', department: 'Stores',
        approval: { required: 'above_amount', role: 'owner', amount_inr: 50000 } },
    ],
  },
});
registry.set(plant.id, plant);
const pack = resolvePack(plant, (id) => registry.get(id));

const suite = EvalSuiteSchema.parse({
  pack: 'plant-eval',
  cases: [
    { id: 'pump', request: 'Boiler feed pump B vibration above limit', source: 'system',
      expect: { category: 'breakdown', priority: 'P1', review: 'complete', approval: { required: true, role: 'safety-officer' }, signoff: { required: true, role: 'maintenance-head' } } },
    { id: 'vague', request: 'Something tripped near bay 4', source: 'staff',
      expect: { category: 'breakdown', priority: 'P1', review: 'needs_info' } },
    { id: 'cheap-spares', request: 'Purchase spares worth ₹20,000', source: 'staff',
      expect: { category: 'spares', priority: 'P4', review: 'complete', approval: { required: false }, signoff: { required: false } } },
    { id: 'big-spares', request: 'Purchase spares', amount_inr: 120000, source: 'owner',
      expect: { category: 'spares', priority: 'P4', review: 'complete', approval: { required: true, role: 'owner' }, signoff: { required: false } } },
  ],
});

describe('eval runner', () => {
  it('scores every stage and records no failures on a correct pack', () => {
    const card = runSuite(pack, suite, new Date('2026-10-13T06:00:00Z'));
    expect(card.total).toBe(4);
    expect(card.failures).toEqual([]);
    expect(card.stages.category).toEqual({ correct: 4, total: 4 });
    expect(card.stages.approval).toEqual({ correct: 3, total: 3 });
  });

  it('reports what went wrong', () => {
    const wrong = EvalSuiteSchema.parse({ ...suite, cases: [{ ...suite.cases[0]!, expect: { ...suite.cases[0]!.expect, priority: 'P3' } }] });
    const card = runSuite(pack, wrong);
    expect(card.failures).toEqual([{ caseId: 'pump', stage: 'priority', expected: 'P3', got: 'P1' }]);
  });
});
