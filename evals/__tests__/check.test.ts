import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { checkDraft } from '../src/check-lib.ts';

/** A throwaway packs dir: real core-business and crm-base plus a fixture sector pack. */
const packsDir = mkdtempSync(join(tmpdir(), 'packs-'));
const repoPacks = new URL('../../packs', import.meta.url).pathname;
for (const id of ['core-business', 'crm-base']) cpSync(join(repoPacks, id), join(packsDir, id), { recursive: true });

const body = 'Check the request, write down what is missing, and call the person back the same day. '.repeat(3);
const STAGES = {
  request: { name: 'Job raised' }, review: { name: 'First check' }, classify: { name: 'Priority set' }, assign: { name: 'Crew named' },
  approve: { name: 'Permit and clearance' }, execute: { name: 'Work under permit' }, close: { name: 'Permit returned' }, report: { name: 'Monthly review' },
};
const categories = [
  { id: 'breakdown', name: 'Breakdown repair', keywords: ['breakdown', 'tripped', 'not working'], priority: 'P1', risk: 'high', department: 'Maintenance', approval: { required: 'high_risk_or_p1', role: 'shift-charge-engineer' } },
  { id: 'spares', name: 'Spares purchase', keywords: ['spares', 'purchase', 'buy'], priority: 'P4', risk: 'low', department: 'Stores', approval: { required: 'above_amount', role: 'plant-head', amount_inr: 50000 } },
  { id: 'cleaning', name: 'Cleaning job', keywords: ['cleaning', 'clean', 'sweep'], priority: 'P3', department: 'Facilities' },
  { id: 'painting', name: 'Painting job', keywords: ['painting', 'paint', 'repaint'], priority: 'P4', department: 'Facilities' },
  { id: 'audit', name: 'Safety audit', keywords: ['audit', 'inspection', 'survey'], priority: 'P3', department: 'Safety' },
];
const examples = [
  ['Coal mill 2 breakdown, stopped at 3 am', 'breakdown', 'P1', true], ['Feeder 4 tripped again', 'breakdown', 'P1', true],
  ['Please buy spares for the ash pump', 'spares', 'P4', false], ['Purchase gaskets for the heater', 'spares', 'P4', false],
  ['Clean the control room floor', 'cleaning', 'P3', false], ['Sweep the yard near gate 2', 'cleaning', 'P3', false],
  ['Repaint the stair rails', 'painting', 'P4', false], ['Paint the new store room', 'painting', 'P4', false],
  ['Fire safety audit due next week', 'audit', 'P3', false], ['Annual inspection of the cranes', 'audit', 'P3', false],
].map(([request, category, priority, approval]) => ({ request, category, priority, approval }));

mkdirSync(join(packsDir, 'sector-energy-heavy-industry'));
writeFileSync(join(packsDir, 'sector-energy-heavy-industry', 'pack.yaml'), stringify({
  id: 'sector-energy-heavy-industry', version: '1.0.0', name: 'Energy & Heavy Industry', description: 'Sector base', kind: 'base',
  sector: 'energy-heavy-industry', extends: ['crm-base'],
  lifecycle: { case: { label: 'Work order', plural: 'Work orders', prefix: 'WO' }, stages: STAGES, categories },
  playbooks: [1, 2, 3].map((n) => ({ id: `sector-pb-${n}`, title: `Sector playbook ${n}`, body })),
  other_org_types: ['cement', 'steel', 'mining', 'oil', 'gas', 'chemical', 'solar epc', 'wind'].map((k) => ({ name: `${k} works`, keywords: [k], closest: 'manufacturing-plant' })),
}));

const draft = (overrides: Record<string, unknown> = {}) => stringify({
  id: 'power-plant', version: '1.0.0', name: 'Power plant & utilities', description: 'Generation', sector: 'energy-heavy-industry',
  extends: ['sector-energy-heavy-industry'],
  lifecycle: {
    case: { label: 'Job', plural: 'Jobs', prefix: 'JOB' }, stages: STAGES,
    roles: [{ id: 'shift-charge-engineer', name: 'Shift charge engineer', approves: 'Permits' }, { id: 'plant-head', name: 'Plant head', approves: 'Purchases' }],
    urgent_keywords: ['fire', 'electrocution', 'explosion'], categories, examples,
  },
  playbooks: [1, 2, 3].map((n) => ({ id: `pp-${n}`, title: `Plant playbook ${n}`, body })),
  ...overrides,
});
const suite = (cases: object[]) => stringify({ pack: 'power-plant', cases });
const good = [
  { id: 'trip', request: 'Unit 1 tripped on low drum level at 02:14', source: 'system', expect: { category: 'breakdown', priority: 'P1', review: 'complete', approval: { required: true, role: 'shift-charge-engineer' } } },
  { id: 'gaskets', request: 'Buy 20 spares gaskets for ₹8,000', source: 'staff', expect: { category: 'spares', priority: 'P4', review: 'complete', approval: { required: false } } },
];

describe('checkDraft', () => {
  it('passes a clean pack and its test set', () => {
    const result = checkDraft({ packYaml: draft(), suiteYaml: suite(good), packsDir });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.scorecard!.stages.category).toEqual({ correct: 2, total: 2 });
  });

  it('reports YAML and schema errors instead of throwing', () => {
    expect(checkDraft({ packYaml: 'id: [broken', packsDir }).issues[0]).toMatch(/^pack: /);
    expect(checkDraft({ packYaml: draft({ version: 'one' }), packsDir }).ok).toBe(false);
  });

  it('reports scores below the thresholds', () => {
    const wrong = [{ ...good[0]!, expect: { ...good[0]!.expect, category: 'spares' } }];
    const result = checkDraft({ packYaml: draft(), suiteYaml: suite(wrong), packsDir });
    expect(result.issues).toContain('category 0% is below 90%');
  });

  it('refuses examples copied from the test set', () => {
    const copied = [{ ...good[0]!, request: 'Coal mill 2 breakdown, stopped at 3 am.' }];
    const result = checkDraft({ packYaml: draft(), suiteYaml: suite(copied), packsDir });
    expect(result.issues).toContain('test case trip: its request is also a worked example in the pack');
  });

  it('checks a sector pack with the sector rules', () => {
    const sectorYaml = stringify({ id: 'sector-energy-heavy-industry', version: '1.0.0', name: 'Energy', description: 'x', kind: 'base', sector: 'energy-heavy-industry', extends: ['crm-base'] });
    expect(checkDraft({ packYaml: sectorYaml, packsDir }).issues).toContain('other_org_types: needs at least 8 similar types (has 0)');
  });
});
