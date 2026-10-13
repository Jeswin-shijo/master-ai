import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ORG_TYPES, SECTOR_IDS, type Pack, type ResolvedPack } from '@onehuman/schemas';
import {
  applyPackUpdates,
  checkPackQuality,
  checkSectorPack,
  composeForSector,
  matchIndustry,
  packUpdates,
  parsePack,
  resolvePack,
  validatePackRefs,
} from './index';

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
const all = [...registry.values()];

describe('ready-made content', () => {
  it.each(SECTOR_IDS.map((s) => [s]))('sector %s has a complete base pack', (sector) => {
    const pack = registry.get(`sector-${sector}`);
    expect(pack, `packs/sector-${sector}/pack.yaml`).toBeDefined();
    expect(checkSectorPack(pack!)).toEqual([]);
    expect(validatePackRefs(resolvePack(pack!, lookup))).toEqual([]);
  });

  it.each(ORG_TYPES.map((t) => [t.id, t]))('%s is ready to offer', (id, type) => {
    const pack = registry.get(id);
    expect(pack, `packs/${id}/pack.yaml`).toBeDefined();
    expect(pack!.sector).toBe(type.sector);
    const resolved = resolvePack(pack!, lookup);
    expect(validatePackRefs(resolved)).toEqual([]);
    expect(checkPackQuality(resolved)).toEqual([]);
  });

  it('offers no sector-tagged pack outside the taxonomy', () => {
    const ids = new Set(ORG_TYPES.map((t) => t.id));
    expect(all.filter((p) => p.kind === 'industry' && p.sector && !ids.has(p.id)).map((p) => p.id)).toEqual([]);
  });
});

describe('ready-made packs now win for common types', () => {
  const industry = all.filter((p) => p.kind === 'industry');
  it.each([
    ['Dental clinic in Kochi', 'hospital'],
    ['NEET coaching institute', 'education'],
    ['Construction company', 'construction'],
    ['NBFC giving gold loans', 'lender'],
    ['Transport company with 40 trucks', 'logistics'],
    ['Thermal power station', 'power-plant'],
    ['Section 8 company running skill programmes', 'ngo'],
    ['We are an IT services company in Pune', 'it-services'],
  ])('%s → %s', (text, id) => {
    expect(matchIndustry(text, industry)?.pack.id).toBe(id);
  });

  it('construction keeps the daily work report', () => {
    const construction = resolvePack(registry.get('construction')!, lookup);
    expect(construction.routines.map((r) => r.id)).toContain('daily-work-report');
  });
});

describe('signup words that must not pick a pack', () => {
  const industry = all.filter((p) => p.kind === 'industry');
  it.each([
    'Travel company, my wife runs it',
    'Small bakery, we bake it fresh daily',
    'We make it easy to rent bikes',
    'Veterinary hospital',
    'Pet hospital',
    'Animal hospital and pet clinic',
    'Government veterinary dispensary',
  ])('%s → no IT or human hospital pack', (text) => {
    expect(['it-services', 'hospital']).not.toContain(matchIndustry(text, industry)?.pack.id);
  });

  it('a vet hospital typed under public services does not borrow the human hospital pack', () => {
    expect(composeForSector('Veterinary hospital', 'public-services', all).basedOn).not.toBe('hospital');
  });
});

describe('typed-in types', () => {
  it.each([
    ['Cement plant in Andhra', 'energy-heavy-industry', 'manufacturing-plant'],
    ['Solar park operator', 'energy-heavy-industry', 'power-plant'],
    ['Cold storage chain', 'trade-logistics-tourism', 'logistics'],
    ['Insurance broker', 'finance-development', 'sector-finance-development'],
    ['Banquet hall and wedding venue', 'trade-logistics-tourism', 'sector-trade-logistics-tourism'],
    ['Edtech app, we built it for NEET students', 'technology-innovation', 'software-saas'],
    ['Diagnostic lab', 'public-services', 'hospital'],
  ] as const)('%s in %s builds on %s', (text, sector, expected) => {
    const c = composeForSector(text, sector, all);
    if (expected) expect(c.basedOn).toBe(expected);
    const resolved = resolvePack(c.pack, lookup, 'generated');
    expect(validatePackRefs(resolved)).toEqual([]);
    expect(resolved.lifecycle!.stages.every((s) => s.name.length > 0)).toBe(true);
  });
});

describe('travel agency upgrade', () => {
  it('upgrades a pre-lifecycle travel workspace cleanly', () => {
    const latest = resolvePack(registry.get('travel-agency')!, lookup);
    const { lifecycle: _drop, ...rest } = latest;
    const old = {
      ...rest,
      lineage: ['core-business', 'crm-base', 'bookings-base', 'travel-agency'],
      agents: rest.agents.filter((a) => a.role !== 'case-coordinator'),
      playbooks: [],
    } as ResolvedPack;
    const updates = packUpdates(old, latest);
    expect(updates.lifecycle.whole?.case.label).toBe(latest.lifecycle!.case.label);
    expect(validatePackRefs(applyPackUpdates(old, updates))).toEqual([]);
  });

  it('keeps every part it had before', () => {
    const travel = registry.get('travel-agency')!;
    expect(travel.entities.map((e) => e.name)).toEqual(expect.arrayContaining(['Trip', 'Itinerary', 'Supplier']));
    expect(travel.agents.map((a) => a.role)).toEqual(expect.arrayContaining(['trip-intake', 'itinerary-planner', 'booking-coordinator']));
    expect(travel.workflows.map((w) => w.id)).toEqual(expect.arrayContaining(['new-enquiry', 'itinerary-to-booking', 'disruption-response']));
    expect(travel.policies.map((p) => p.id)).toEqual(expect.arrayContaining(['confirm-booking', 'refund-above-5000']));
  });
});
