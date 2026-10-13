import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Pack } from '@onehuman/schemas';
import {
  composeOfflinePack,
  detectFamily,
  entityValidator,
  applyPackUpdates,
  countPackUpdates,
  matchIndustry,
  packUpdates,
  parsePack,
  prepareArgs,
  resolvePack,
  resolveTool,
  toolDefinition,
  validatePackRefs,
} from './index';

const PACKS_DIR = join(__dirname, '../../../packs');

function loadRegistry(): Map<string, Pack> {
  const registry = new Map<string, Pack>();
  for (const dir of readdirSync(PACKS_DIR)) {
    const file = join(PACKS_DIR, dir, 'pack.yaml');
    if (!existsSync(file)) continue;
    const pack = parsePack(parse(readFileSync(file, 'utf8')));
    registry.set(pack.id, pack);
  }
  return registry;
}

const registry = loadRegistry();
const lookup = (id: string) => registry.get(id);

describe('pack registry', () => {
  it('loads every pack on disk', () => {
    expect([...registry.keys()]).toEqual(
      expect.arrayContaining(['bookings-base', 'core-business', 'crm-base', 'orders-base', 'projects-base', 'travel-agency']),
    );
  });

  it.each([...registry.keys()])('%s resolves with valid cross-references', (id) => {
    const resolved = resolvePack(registry.get(id)!, lookup);
    expect(validatePackRefs(resolved)).toEqual([]);
  });

  it('travel-agency inherits bookings and crm and overrides booking-coordinator', () => {
    const travel = resolvePack(registry.get('travel-agency')!, lookup);
    expect(travel.lineage).toEqual(['core-business', 'crm-base', 'bookings-base', 'travel-agency']);
    const roles = travel.agents.map((a) => a.role);
    expect(roles).toEqual(expect.arrayContaining(['ops-assistant', 'enquiry-intake', 'trip-intake', 'booking-coordinator']));
    const coordinator = travel.agents.find((a) => a.role === 'booking-coordinator')!;
    expect(coordinator.tools).toContain('trips.search');
    expect(travel.entities.find((e) => e.name === 'Customer')!.label).toBe('Traveller');
  });
});

describe('industry matching', () => {
  const industryPacks = [...registry.values()];

  it.each(['Travel agency', 'we are a tour operator in Kerala', 'Tours and Travels'])('matches %s to travel-agency', (text) => {
    expect(matchIndustry(text, industryPacks)?.pack.id).toBe('travel-agency');
  });

  it.each(['dental clinic', 'coaching institute', 'cloud kitchen'])('does not force a match for %s', (text) => {
    expect(matchIndustry(text, industryPacks)).toBeNull();
  });

  it.each([
    ['Dental clinic in Kochi', 'bookings'],
    ['NEET coaching institute', 'education'],
    ['Cloud kitchen and catering', 'orders'],
    ['Chartered accountant firm', 'projects'],
    ['Something unusual', 'general'],
  ] as const)('detects %s as %s', (text, family) => {
    expect(detectFamily(text)).toBe(family);
  });

  it('composes an offline pack with sector labels', () => {
    const pack = composeOfflinePack('Dental clinic in Kochi');
    const resolved = resolvePack(pack, lookup, 'generated');
    expect(validatePackRefs(resolved)).toEqual([]);
    expect(resolved.entities.find((e) => e.name === 'Customer')!.label).toBe('Patient');
    expect(resolved.entities.find((e) => e.name === 'Booking')!.label).toBe('Appointment');
    expect(resolved.agents.find((a) => a.role === 'booking-coordinator')!.description).toMatch(/appointment/i);
  });

  it('composes an education pack', () => {
    const resolved = resolvePack(composeOfflinePack('Coaching institute for NEET'), lookup, 'generated');
    expect(resolved.entities.find((e) => e.name === 'Customer')!.label).toBe('Student');
    expect(resolved.entities.find((e) => e.name === 'Booking')!.label).toBe('Enrollment');
  });
});

describe('routines', () => {
  it('every check-in question is complete and keys are unique', () => {
    for (const pack of registry.values()) {
      for (const r of pack.routines) {
        expect(new Set(r.questions.map((q) => q.key)).size, `${pack.id}/${r.id}`).toBe(r.questions.length);
        for (const q of r.questions) expect(q.ask, `${pack.id}/${r.id}/${q.key}`).toMatch(/\?$/);
      }
    }
  });

  it('a construction company gets a daily work report and a status update', () => {
    const construction = resolvePack(composeOfflinePack('Construction company'), lookup, 'generated');
    expect(construction.routines.map((r) => r.id).sort()).toEqual(['daily-update', 'daily-work-report']);
    expect(construction.routines.find((r) => r.id === 'daily-work-report')!.questions.map((q) => q.type)).toEqual(['number', 'text', 'percent', 'text', 'text']);
  });
});

describe('pack updates', () => {
  // A workspace installed before core-business gained the work coordinator.
  const latest = resolvePack(composeOfflinePack('Construction company'), lookup, 'generated');
  const installed = {
    ...latest,
    agents: latest.agents.filter((a) => a.role !== 'work-coordinator').map((a, i) => (i === 0 ? { ...a, name: 'Renamed by owner' } : a)),
    workflows: latest.workflows.filter((w) => w.id !== 'delegate-work'),
  };

  it('finds what newer base packs add, and nothing else', () => {
    const updates = packUpdates(installed, latest);
    expect(updates.agents.map((a) => a.role)).toEqual(['work-coordinator']);
    expect(updates.workflows.map((w) => w.id)).toEqual(['delegate-work']);
    expect(countPackUpdates(updates)).toBe(2);
    expect(countPackUpdates(packUpdates(latest, latest))).toBe(0);
  });

  it('applies additively and keeps owner changes', () => {
    const next = applyPackUpdates(installed, packUpdates(installed, latest));
    expect(validatePackRefs(next)).toEqual([]);
    expect(next.agents[0]!.name).toBe('Renamed by owner');
    expect(next.agents.find((a) => a.role === 'work-coordinator')!.tools).toContain('staff.delegate');
    expect(countPackUpdates(packUpdates(next, latest))).toBe(0);
  });

  it('drops additions that would point at something the workspace lacks', () => {
    const empty = { ...installed, entities: [], agents: [], tools: [], workflows: [], policies: [], kpis: [] };
    const updates = packUpdates(empty, latest);
    expect(updates.agents.map((a) => a.role)).toContain('work-coordinator');
    expect(updates.tools.every((t) => typeof t.with?.entity !== 'string')).toBe(true);
    expect(validatePackRefs(applyPackUpdates(empty, updates))).toEqual([]);
  });
});

describe('tools', () => {
  const travel = resolvePack(registry.get('travel-agency')!, lookup);

  it('resolves aliases with fixed arguments and risk overrides', () => {
    const confirm = resolveTool(travel, 'booking.confirm')!;
    expect(confirm.primitive.name).toBe('records.update');
    expect(confirm.risk.externalReach).toBe(true);
    expect(confirm.risk.reversible).toBe(false);
    const prepared = prepareArgs(confirm, { id: 'b-1', patch: { notes: 'ok' }, entity: 'Trip' });
    expect(prepared).toEqual({
      ok: true,
      args: { id: 'b-1', entity: 'Booking', patch: { notes: 'ok', status: 'confirmed' } },
    });
  });

  it('hides fixed arguments from the model', () => {
    const def = toolDefinition(resolveTool(travel, 'suppliers.search')!);
    expect(def.name).toBe('suppliers__search');
    expect(Object.keys((def.input_schema as { properties: object }).properties)).not.toContain('entity');
  });

  it('reports invalid arguments instead of throwing', () => {
    const refund = resolveTool(travel, 'refund.issue')!;
    const prepared = prepareArgs(refund, { amount: -5 });
    expect(prepared.ok).toBe(false);
  });

  it('validates records against entity fields', () => {
    const trip = travel.entities.find((e) => e.name === 'Trip')!;
    const validator = entityValidator(trip);
    expect(validator.safeParse({ travellerName: 'Asha', destination: 'Munnar', status: 'enquiry' }).success).toBe(true);
    expect(validator.safeParse({ travellerName: 'Asha', status: 'flying' }).success).toBe(false);
  });
});
