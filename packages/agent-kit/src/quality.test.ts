import { describe, expect, it } from 'vitest';
import { ORG_TYPES, PackSchema, SECTOR_IDS, type Pack } from '@onehuman/schemas';
import { checkPackQuality, checkSectorPack, parsePack, resolvePack } from './index';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const read = (id: string) => parsePack(parse(readFileSync(join(__dirname, `../../../packs/${id}/pack.yaml`), 'utf8')));
const base = new Map<string, Pack>(['core-business', 'crm-base'].map((id) => [id, read(id)]));

const body = 'Check the request, write down what is missing, and call the person back the same day. '.repeat(3);
const STAGES = {
  request: { name: 'Job raised' }, review: { name: 'First check' }, classify: { name: 'Priority set' }, assign: { name: 'Crew named' },
  approve: { name: 'Permit and clearance' }, execute: { name: 'Work under permit' }, close: { name: 'Permit returned' }, report: { name: 'Monthly review' },
};
const categories = ['breakdown', 'maintenance', 'shutdown', 'permit', 'complaint'].map((id, i) => ({
  id, name: `Kind ${id}`, keywords: [`${id} one`, `${id} two`, `${id} three`], priority: (['P1', 'P2', 'P3', 'P4', 'P3'] as const)[i]!, department: 'Plant',
}));

function sectorPack(overrides: Record<string, unknown> = {}): Pack {
  return parsePack({
    id: 'sector-energy-heavy-industry', version: '1.0.0', name: 'Energy & Heavy Industry', description: 'Sector base', kind: 'base',
    sector: 'energy-heavy-industry', extends: ['crm-base'],
    lifecycle: { case: { label: 'Work order', plural: 'Work orders', prefix: 'WO' }, stages: STAGES, categories },
    playbooks: [1, 2, 3].map((n) => ({ id: `sector-pb-${n}`, title: `Playbook ${n}`, body })),
    other_org_types: ['cement', 'steel', 'mining', 'oil', 'gas', 'chemical', 'solar epc', 'wind'].map((k) => ({ name: `${k} works`, keywords: [k], closest: 'manufacturing-plant' })),
    ...overrides,
  });
}

function orgPack(overrides: Record<string, unknown> = {}): Pack {
  return parsePack({
    id: 'power-plant', version: '1.0.0', name: 'Power plant & utilities', description: 'Generation', sector: 'energy-heavy-industry',
    extends: ['sector-energy-heavy-industry'],
    lifecycle: {
      case: { label: 'Job', plural: 'Jobs', prefix: 'JOB' },
      stages: STAGES,
      roles: [{ id: 'shift-charge-engineer', name: 'Shift charge engineer', approves: 'Permits' }],
      urgent_keywords: ['fire', 'electrocution', 'explosion'],
      categories,
      examples: categories.flatMap((c) => [1, 2].map((n) => ({ request: `${c.id} example ${n}`, category: c.id, priority: c.priority, approval: false }))),
    },
    playbooks: [1, 2, 3].map((n) => ({ id: `pp-${n}`, title: `Playbook ${n}`, body })),
    ...overrides,
  });
}

function resolve(pack: Pack, sector = sectorPack()) {
  const all = new Map(base);
  all.set(sector.id, sector);
  all.set(pack.id, pack);
  return resolvePack(pack, (id) => all.get(id));
}

describe('taxonomy', () => {
  it('has three ready-made types per sector', () => {
    for (const sector of SECTOR_IDS) expect(ORG_TYPES.filter((t) => t.sector === sector)).toHaveLength(3);
    expect(ORG_TYPES.map((t) => t.id)).toContain('travel-agency');
  });

  it('parses playbooks and similar types, and defaults them to empty', () => {
    const minimal = PackSchema.parse({ id: 'x', version: '1.0.0', name: 'X', description: 'x' });
    expect(minimal.playbooks).toEqual([]);
    expect(minimal.other_org_types).toEqual([]);
    expect(() => PackSchema.parse({ id: 'x', version: '1.0.0', name: 'X', description: 'x', playbooks: [{ id: 'a', title: 'A', body: 'too short' }] })).toThrow();
  });

  it('merges playbooks down the chain by id', () => {
    const resolved = resolve(orgPack({ playbooks: [{ id: 'sector-pb-1', title: 'Own version', body }, { id: 'pp-9', title: 'Extra', body }] }));
    expect(resolved.playbooks.map((p) => p.id).sort()).toEqual(['pp-9', 'sector-pb-1', 'sector-pb-2', 'sector-pb-3']);
    expect(resolved.playbooks.find((p) => p.id === 'sector-pb-1')!.title).toBe('Own version');
  });
});

describe('checkPackQuality', () => {
  it('passes a complete organization pack', () => {
    expect(checkPackQuality(resolve(orgPack()))).toEqual([]);
  });

  it('names what a thin pack lacks', () => {
    const thin = orgPack({
      lifecycle: { stages: { ...STAGES, review: { name: 'Check' } }, categories: categories.slice(0, 3).map((c) => ({ ...c, keywords: ['one'] })) },
      playbooks: [],
    });
    // Under a sector pack that names only its stages, nothing specific is inherited.
    expect(checkPackQuality(resolve(thin, sectorPack({ lifecycle: { stages: STAGES } })))).toEqual(expect.arrayContaining([
      'lifecycle: the case still has the generic name "Case"',
      'stage review: "Check" should be 2 to 5 words',
      'lifecycle: needs at least 5 case types of its own (has 3)',
      'case type breakdown: needs at least 3 keywords',
      'case type breakdown: needs at least 2 worked examples',
      'playbooks: needs 3 to 6 (has 3 from the sector, none of its own)',
      'lifecycle: needs its own urgent keywords',
      'lifecycle: needs at least one approver role besides the owner',
    ]));
  });

  it('needs the pack to sit under its sector pack', () => {
    const loose = orgPack({ extends: ['crm-base'] });
    expect(checkPackQuality(resolve(loose))).toContain('lineage: must extend sector-energy-heavy-industry');
  });
});

describe('checkSectorPack', () => {
  it('passes a complete sector pack', () => {
    expect(checkSectorPack(sectorPack())).toEqual([]);
  });

  it('refuses closest types from another sector', () => {
    const wrong = sectorPack({ other_org_types: [...sectorPack().other_org_types, { name: 'Clinic chain', keywords: ['clinic'], closest: 'hospital' }] });
    expect(checkSectorPack(wrong)).toContain('similar type "Clinic chain": hospital is not a ready-made type in energy-heavy-industry');
  });

  it('names a misnamed or thin sector pack', () => {
    expect(checkSectorPack(sectorPack({ id: 'sector-energy', other_org_types: [] }))).toEqual(expect.arrayContaining([
      'id: a sector base pack must be called sector-energy-heavy-industry',
      'other_org_types: needs at least 8 similar types (has 0)',
    ]));
  });
});
