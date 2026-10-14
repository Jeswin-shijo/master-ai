import { describe, expect, it } from 'vitest';
import type { EntityDef } from '@onehuman/schemas';
import { applyPackUpdates, countPackUpdates, packUpdates, parsePack, resolvePack, validatePackRefs } from '../src/index';

const Ticket: EntityDef = {
  name: 'Ticket', label: 'Ticket',
  fields: [
    { name: 'summary', label: 'Summary', type: 'string', required: true },
    { name: 'dueBy', label: 'Due by', type: 'datetime', required: false },
  ],
};
const Asset = (extra: EntityDef['fields']): EntityDef => ({
  name: 'Asset', label: 'Asset', fields: [{ name: 'assetTag', label: 'Asset tag', type: 'string', required: true }, ...extra],
});
const make = (entities: EntityDef[], registers: unknown[]) =>
  resolvePack(parsePack({ id: 'it', version: '1.0.0', name: 'IT', description: 'IT', entities, registers }), () => undefined);

const latest = make(
  [
    Asset([
      { name: 'warrantyEndsOn', label: 'Warranty ends on', type: 'date', required: false },
      { name: 'owner', label: 'Owner', type: 'string', required: true },
    ]),
    Ticket,
  ],
  [
    { id: 'tickets', entity: 'Ticket', checks: [{ overdue: { date: 'dueBy' } }] },
    { id: 'assets', entity: 'Asset', checks: [{ expiring: { date: 'warrantyEndsOn', days: 30 } }] },
    { id: 'owned-assets', entity: 'Asset', columns: ['owner'] },
  ],
);
const installed = make([Asset([])], []);

describe('pack updates for lists', () => {
  const u = packUpdates(installed, latest);

  it('offers new record types, new optional fields and new lists', () => {
    expect(u.entities.map((e) => e.name)).toEqual(['Ticket']);
    expect(u.fields).toEqual([{ entity: 'Asset', fields: [expect.objectContaining({ name: 'warrantyEndsOn' })] }]);
    expect(u.registers.map((r) => r.id)).toEqual(['tickets', 'assets']);
  });

  it('never adds a required field, and leaves out a list that needs one', () => {
    expect(u.fields[0]!.fields.map((f) => f.name)).not.toContain('owner');
    expect(u.registers.map((r) => r.id)).not.toContain('owned-assets');
  });

  it('applies cleanly and only once', () => {
    const next = applyPackUpdates(installed, u);
    // These small packs carry no case coordinator, so the lifecycle check is not what is under test.
    expect(validatePackRefs(next).filter((i) => !i.startsWith('lifecycle:'))).toEqual([]);
    expect(next.entities.find((e) => e.name === 'Asset')!.fields.map((f) => f.name)).toEqual(['assetTag', 'warrantyEndsOn']);
    expect(countPackUpdates(u)).toBe(4);
    expect(countPackUpdates(packUpdates(next, latest))).toBe(0);
  });
});
