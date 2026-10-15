import { describe, expect, it } from 'vitest';
import type { EntityDef, FollowUp, Register, ResolvedPack, RoutineTemplate } from '@onehuman/schemas';
import {
  applyPackUpdates,
  collectAsk,
  countPackUpdates,
  fittingRegisters,
  fittingRoutines,
  packUpdates,
  registersOf,
  validateCollects,
  validateRegisters,
} from '../src/index';

const Party: EntityDef = {
  name: 'Party',
  label: 'Party',
  fields: [
    { name: 'name', label: 'Name', type: 'string', required: true },
    { name: 'phone', label: 'Phone', type: 'phone', required: false },
  ],
};
const Bill: EntityDef = {
  name: 'Bill',
  label: 'Bill',
  fields: [
    { name: 'billNo', label: 'Bill no.', type: 'string', required: true },
    { name: 'party', label: 'Party', type: 'reference', ref: 'Party', required: false },
    { name: 'billDate', label: 'Bill date', type: 'date', required: false },
    { name: 'total', label: 'Total', type: 'money', required: false },
    { name: 'dueDate', label: 'Due date', type: 'date', required: false },
    { name: 'paymentStatus', label: 'Payment', type: 'enum', options: ['unpaid', 'paid'], required: false },
    { name: 'clerk', label: 'Clerk', type: 'string', required: false },
  ],
};
const unpaid: FollowUp = {
  id: 'unpaid-bills',
  label: 'Unpaid bills → the party',
  who: 'party',
  due: { overdue: { date: 'dueDate', grace_days: 2 } },
  when: { paymentStatus: ['unpaid'] },
  phone: { ref: 'party', field: 'phone' },
  contact: { ref: 'party', field: 'name' },
  about: ['billNo', 'total'],
  find_out: ['paymentStatus'],
  max_tries: 3,
};
const bills = (followUps: FollowUp[]): Register => ({ id: 'bills', entity: 'Bill', main: true, checks: [], follow_ups: followUps });
const pack = (registers: Register[], routines: RoutineTemplate[] = []) => ({ entities: [Party, Bill], registers, routines });

describe('follow-ups on a list', () => {
  it('resolves paths, the due rule and the defaults', () => {
    const [f] = registersOf(pack([bills([unpaid])])).find((r) => r.id === 'bills')!.followUps;
    expect(f).toMatchObject({ key: 'bills.unpaid-bills', who: 'party', everyDays: 3, maxTries: 3, hours: null });
    expect(f!.due).toMatchObject({ kind: 'overdue', graceDays: 2, field: { name: 'dueDate' } });
    expect(f!.phone).toMatchObject({ kind: 'ref', ref: { name: 'party' }, target: { name: 'Party' }, field: { name: 'phone' } });
    expect(f!.about.map((x) => x.name)).toEqual(['billNo', 'total']);
  });

  it('calls staff once a day unless told otherwise', () => {
    const staff: FollowUp = { ...unpaid, id: 'chase-clerk', who: 'staff', phone: undefined, contact: undefined, staff: { field: 'clerk' } };
    const [f] = registersOf(pack([bills([staff])])).find((r) => r.id === 'bills')!.followUps;
    expect(f).toMatchObject({ who: 'staff', everyDays: 1, staffField: { name: 'clerk' } });
  });

  it('reports every path that does not fit the record types', () => {
    const bad: FollowUp = {
      ...unpaid,
      due: { overdue: { date: 'total', grace_days: 0 } },
      when: { paymentStatus: ['lost'] },
      phone: { ref: 'billNo', field: 'phone' },
      contact: { lookup: 'Supplier', match: 'name', value: 'party', field: 'name' },
      about: ['nope'],
      find_out: ['missing'],
    };
    const issues = validateRegisters(pack([bills([bad, bad])]));
    expect(issues).toEqual(
      expect.arrayContaining([
        'register bills follow-up unpaid-bills: duplicate id',
        'register bills follow-up unpaid-bills: due total must be date or datetime, not money',
        'register bills follow-up unpaid-bills: lost is not an option of paymentStatus',
        'register bills follow-up unpaid-bills: phone billNo is not a reference field',
        'register bills follow-up unpaid-bills: contact looks up Supplier, which is not a record type',
        'register bills follow-up unpaid-bills: about nope is not a field of Bill',
        'register bills follow-up unpaid-bills: find_out missing is not a field of Bill',
      ]),
    );
  });

  it('needs the phone to end at a phone field', () => {
    const issues = validateRegisters(pack([bills([{ ...unpaid, phone: { ref: 'party', field: 'name' } }])]));
    expect(issues).toContain('register bills follow-up unpaid-bills: phone name must be a phone field, not string');
  });
});

describe('collection routines', () => {
  const todays: RoutineTemplate = {
    id: 'todays-bills',
    name: "Today's bills",
    description: 'Bills by phone',
    mode: 'automatic',
    days: [1, 2, 3, 4, 5, 6],
    time: '18:00',
    questions: [],
    collect: { list: 'bills', ask: ['billNo', 'party', 'total'], defaults: { billDate: 'today', paymentStatus: 'unpaid' }, max_items: 15 },
  };

  it('accepts a routine whose required fields are asked or defaulted', () => {
    expect(validateCollects(pack([bills([])], [todays]))).toEqual([]);
  });

  it('reports an unknown list, unknown fields, wrong defaults and a required field left out', () => {
    const wrong: RoutineTemplate = {
      ...todays,
      collect: { list: 'bills', ask: ['party', 'colour'], defaults: { billDate: 'now', paymentStatus: 'lost', party: 'x' }, max_items: 15 },
    };
    expect(validateCollects(pack([bills([])], [wrong, { ...todays, id: 'elsewhere', collect: { ...todays.collect!, list: 'orders' } }]))).toEqual([
      'routine todays-bills: ask colour is not a field of Bill',
      'routine todays-bills: now is for date-time fields, billDate is date',
      'routine todays-bills: lost is not an option of paymentStatus',
      'routine todays-bills: party is both asked and defaulted',
      'routine todays-bills: required field billNo is neither asked nor defaulted',
      'routine elsewhere: no list orders',
    ]);
  });

  it('checks each fixed default against its field', () => {
    const withDefaults = (defaults: Record<string, string | number | boolean>): RoutineTemplate => ({ ...todays, collect: { ...todays.collect!, ask: ['billNo'], defaults } });
    const issues = (defaults: Record<string, string | number | boolean>) => validateCollects(pack([bills([])], [withDefaults(defaults)]));
    expect(issues({ billDate: 'today', total: 0, paymentStatus: 'unpaid' })).toEqual([]);
    expect(issues({ total: 'unknown' })).toContain('routine todays-bills: total is money, so its default must be a number');
    expect(issues({ clerk: 5 })).toContain('routine todays-bills: clerk is string, so its default cannot be a number');
    expect(issues({ billDate: 'now' })).toContain('routine todays-bills: now is for date-time fields, billDate is date');
    expect(issues({ clerk: 'today' })).toContain('routine todays-bills: today is for date fields, clerk is string');
  });

  it('asks the asked fields in order, less the defaulted ones', () => {
    const reg = registersOf(pack([bills([])])).find((r) => r.id === 'bills')!;
    expect(collectAsk(reg, { ask: ['total', 'billNo', 'billDate'], defaults: { billDate: 'today' } }).map((f) => f.name)).toEqual(['total', 'billNo']);
  });
});

describe('follow-ups as updates', () => {
  const resolved = (registers: Register[], routines: RoutineTemplate[] = []) =>
    ({ entities: [Party, Bill], registers, routines, agents: [], tools: [], workflows: [], policies: [], kpis: [], playbooks: [] }) as unknown as ResolvedPack;

  it('offers new follow-ups on lists the workspace has, and adds them without replacing', () => {
    const second: FollowUp = { ...unpaid, id: 'second' };
    const installed = resolved([bills([unpaid])]);
    const u = packUpdates(installed, resolved([bills([unpaid, second])]));
    expect(u.followUps).toEqual([{ register: 'bills', followUps: [second] }]);
    expect(countPackUpdates(u)).toBe(1);
    const next = applyPackUpdates(installed, u);
    expect(next.registers?.[0]?.follow_ups?.map((f) => f.id)).toEqual(['unpaid-bills', 'second']);
  });

  it('only offers a collection routine whose list the workspace will have', () => {
    const collect = { list: 'orders', ask: ['billNo'], defaults: {}, max_items: 15 };
    const r: RoutineTemplate = { id: 'orders-call', name: 'Orders', description: 'x', mode: 'automatic', days: [1], time: '18:00', questions: [], collect };
    expect(packUpdates(resolved([bills([])]), resolved([bills([])], [r])).routines).toEqual([]);
  });
});

describe('a pack update that offers a collection routine', () => {
  const resolvedWith = (routines: RoutineTemplate[]) =>
    ({ entities: [Party, Bill], registers: [bills([])], routines, agents: [], tools: [], workflows: [], policies: [], kpis: [], playbooks: [] }) as unknown as ResolvedPack;
  const routine = (over: Partial<RoutineTemplate['collect'] & object>): RoutineTemplate => ({
    id: 'todays-bills', name: 'Bills', description: 'x', mode: 'automatic', days: [1], time: '18:00', questions: [],
    collect: { list: 'bills', ask: ['billNo'], defaults: {}, max_items: 15, ...over },
  });

  it('leaves out one that asks a field the list does not have, or that would fail the checks', () => {
    const installed = resolvedWith([]);
    expect(packUpdates(installed, resolvedWith([routine({ ask: ['billNo', 'colour'] })])).routines).toEqual([]);
    expect(packUpdates(installed, resolvedWith([routine({ defaults: { total: 'unknown' } })])).routines).toEqual([]);
    expect(packUpdates(installed, resolvedWith([routine({})])).routines.map((r) => r.id)).toEqual(['todays-bills']);
  });
});

describe('lists and collections for a pack a model designed', () => {
  it('keeps a list without the follow-up that no longer fits, and drops a collection whose list is gone', () => {
    const broken: FollowUp = { ...unpaid, id: 'broken', phone: { field: 'nope' } };
    const kept = fittingRegisters({ entities: [Party, Bill], registers: [bills([unpaid, broken])] });
    expect(kept.map((r) => r.follow_ups?.map((f) => f.id))).toEqual([['unpaid-bills']]);
    const lost: RoutineTemplate = {
      id: 'orders-call', name: 'Orders', description: 'x', mode: 'automatic', days: [1], time: '18:00', questions: [],
      collect: { list: 'orders', ask: ['billNo'], defaults: {}, max_items: 15 },
    };
    expect(fittingRoutines({ entities: [Party, Bill], registers: kept, routines: [lost] })).toEqual([]);
  });
});
