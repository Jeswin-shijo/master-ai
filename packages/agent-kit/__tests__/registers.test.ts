import { describe, expect, it } from 'vitest';
import type { EntityDef, Register } from '@onehuman/schemas';
import { checkKeys, defaultRegisterId, fittingRegisters, normalizeSnapshot, parsePack, registersOf, resolvePack, titleOf, validatePackRefs, validateRegisters } from '../src/index';

const Party: EntityDef = {
  name: 'Party', label: 'Party', title_field: 'name',
  fields: [
    { name: 'name', label: 'Name', type: 'string', required: true },
    { name: 'phone', label: 'Phone', type: 'phone', required: false },
    { name: 'creditLimit', label: 'Credit limit', type: 'money', required: false },
    { name: 'outstanding', label: 'Outstanding', type: 'money', required: false },
  ],
};
const Bill: EntityDef = {
  name: 'Bill', label: 'Bill', title_field: 'billNo', list_columns: ['billNo', 'party', 'total'],
  fields: [
    { name: 'billNo', label: 'Bill no.', type: 'string', required: true },
    { name: 'billType', label: 'Type', type: 'enum', required: true, options: ['sales invoice', 'purchase bill'] },
    { name: 'party', label: 'Party', type: 'reference', required: false, ref: 'Party' },
    { name: 'billDate', label: 'Bill date', type: 'date', required: false },
    { name: 'taxableValue', label: 'Taxable value', type: 'money', required: false },
    { name: 'gstAmount', label: 'GST amount', type: 'money', required: false },
    { name: 'total', label: 'Total', type: 'money', required: false },
    { name: 'dueDate', label: 'Due date', type: 'date', required: false },
    { name: 'paid', label: 'Paid', type: 'boolean', required: false },
  ],
};
const CashlessRequest: EntityDef = {
  name: 'CashlessRequest', label: 'Cashless request',
  fields: [
    { name: 'sentAt', label: 'Sent at', type: 'datetime', required: false },
    { name: 'amountAsked', label: 'Amount asked', type: 'money', required: false },
  ],
};
const bills: Register = {
  id: 'bills', entity: 'Bill', label: 'Bills', main: true, date_field: 'billDate', totals: ['total'],
  checks: [
    { missing: ['party', 'billDate'] },
    { adds_up: { field: 'total', plus: ['taxableValue', 'gstAmount'], minus: [], tolerance: 1 } },
    { overdue: { date: 'dueDate', grace_days: 0 }, when: { paid: [false] } },
  ],
};
const pack = { entities: [Party, Bill, CashlessRequest], registers: [bills] };

describe('registersOf', () => {
  const lists = registersOf(pack);
  const byId = (id: string) => lists.find((l) => l.id === id)!;

  it("puts the pack's lists first, then a default list for every record type no list covers", () => {
    expect(lists.map((l) => [l.id, l.main, l.explicit])).toEqual([
      ['bills', true, true],
      ['party', false, false],
      ['cashless-request', false, false],
    ]);
  });

  it('gives a default list sensible columns, date, sort, totals and label', () => {
    const party = byId('party');
    expect(party.label).toBe('Parties');
    expect(party.columns.map((f) => f.name)).toEqual(['name', 'phone', 'creditLimit', 'outstanding']);
    expect(party.dateField).toBeNull();
    expect(party.totals.map((f) => f.name)).toEqual(['creditLimit', 'outstanding']);
    const cashless = byId('cashless-request');
    expect(cashless.dateField?.name).toBe('sentAt');
    expect(cashless.sort).toEqual({ field: cashless.dateField, dir: 'desc' });
  });

  it("uses the entity's list columns, and its choice, yes/no and reference fields as filters, when a list names none", () => {
    const b = byId('bills');
    expect(b.columns.map((f) => f.name)).toEqual(['billNo', 'party', 'total']);
    expect(b.filters.map((f) => f.name)).toEqual(['billType', 'party', 'paid']);
  });

  it('turns checks into one problem per missing field, plus a check that references point at real items', () => {
    expect(byId('bills').checks.map((c) => c.key)).toEqual(['missing:party', 'missing:billDate', 'adds_up:total', 'overdue:dueDate', 'ref:party']);
    expect(byId('party').checks).toEqual([]);
  });

  it('skips what a stored snapshot no longer has instead of failing', () => {
    const old = registersOf({
      entities: [Party],
      registers: [bills, { ...bills, id: 'party-list', entity: 'Party', columns: ['name', 'gone'], checks: [{ missing: ['gone'] }] }],
    });
    expect(old.map((l) => l.id)).toEqual(['party-list']);
    expect(old[0]!.columns.map((f) => f.name)).toEqual(['name']);
    expect(old[0]!.checks).toEqual([]);
  });
});

describe('checkKeys, defaultRegisterId, titleOf', () => {
  it('keys checks by kind and fields', () => {
    expect(checkKeys({ limit: { fields: ['a', 'b'], max: 'c', factor: 1 } })).toEqual(['limit:a+b<=c']);
    expect(checkKeys({ limit: { fields: ['stock'], min: 10, factor: 1 } })).toEqual(['limit:stock>=10']);
    expect(checkKeys({ duplicate: ['billNo', 'party'] })).toEqual(['duplicate:billNo,party']);
    expect(checkKeys({ missing: ['a', 'b'] })).toEqual(['missing:a', 'missing:b']);
  });

  it('names default lists in kebab case', () => {
    expect(defaultRegisterId('CashlessRequest')).toBe('cashless-request');
    expect(defaultRegisterId('Bill')).toBe('bill');
  });

  it('titles an item by its title field, else its first text field, else the record type', () => {
    expect(titleOf(Bill, { billNo: 'S-1' })).toBe('S-1');
    expect(titleOf(CashlessRequest, {})).toBe('Cashless request');
  });
});

describe('validateRegisters', () => {
  const issues = (change: object) =>
    validateRegisters({ entities: [Party, Bill], registers: [{ ...bills, checks: [], ...change } as Register] });

  it('accepts a valid list', () => {
    expect(validateRegisters(pack)).toEqual([]);
  });

  it.each([
    [{ entity: 'Nope' }, 'register bills: unknown entity Nope'],
    [{ columns: ['nope'] }, 'register bills: column nope is not a field of Bill'],
    [{ filters: ['billNo'] }, 'register bills: filter billNo must be enum or boolean or reference, not string'],
    [{ date_field: 'total' }, 'register bills: date_field total must be date or datetime, not money'],
    [{ totals: ['billNo'] }, 'register bills: total billNo must be money or number or integer, not string'],
    [{ id: 'party' }, 'register party: the id is taken by the default list of another record type'],
    [{ card: { sum: { field: 'total', when: { billType: ['refund'] }, label: 'x' } } }, 'register bills card sum: refund is not an option of billType'],
    [{ checks: [{ missing: ['party'] }, { missing: ['party'] }] }, 'register bills: two checks share the key missing:party'],
    [{ checks: [{ adds_up: { field: 'total', plus: ['billNo'], minus: [], tolerance: 1 } }] }, 'register bills: adds_up billNo must be money or number or integer, not string'],
    [{ checks: [{ overdue: { date: 'total', grace_days: 0 } }] }, 'register bills: overdue total must be date or datetime, not money'],
    [{ checks: [{ missing: ['total'], when: { billNo: { above: 3 } } }] }, 'register bills check missing:total: above and below need a number field, billNo is string'],
    [{ checks: [{ missing: ['total'], when: { paid: ['yes'] } }] }, 'register bills check missing:total: paid takes true or false'],
    [
      { checks: [{ limit: { fields: ['billDate', 'dueDate'], max: 'dueDate', factor: 1 } }] },
      'register bills check limit:billDate+dueDate<=dueDate: a date limit compares one date field with another date field',
    ],
  ])('reports %j', (change, message) => {
    expect(issues(change)).toContain(message);
  });
});

describe('packs and lists', () => {
  it('merges lists down the extends chain by id, the child winning', () => {
    const base = parsePack({ id: 'base', version: '1.0.0', name: 'Base', description: 'Base', kind: 'base', entities: [Bill, Party], registers: [{ id: 'bills', entity: 'Bill', label: 'Bills' }] });
    const child = parsePack({
      id: 'child', version: '1.0.0', name: 'Child', description: 'Child', extends: ['base'],
      registers: [{ id: 'bills', entity: 'Bill', label: 'Invoices' }, { id: 'parties', entity: 'Party' }],
    });
    const resolved = resolvePack(child, (id) => (id === 'base' ? base : undefined));
    expect(resolved.registers.map((r) => [r.id, r.label])).toEqual([['bills', 'Invoices'], ['parties', undefined]]);
  });

  it('reports list problems with the rest of the pack', () => {
    const p = parsePack({ id: 'p', version: '1.0.0', name: 'P', description: 'P', entities: [Bill, Party], registers: [{ id: 'bills', entity: 'Bill', columns: ['nope'] }] });
    expect(validatePackRefs(resolvePack(p, () => undefined))).toContain('register bills: column nope is not a field of Bill');
  });

  it('reads an old snapshot with no lists as having none', () => {
    const { registers: _gone, ...old } = resolvePack(parsePack({ id: 'p', version: '1.0.0', name: 'P', description: 'P', entities: [Party] }), () => undefined);
    expect(normalizeSnapshot(old as never).registers).toEqual([]);
  });
});

describe('fittingRegisters', () => {
  it('keeps a list that fits its record type and drops one naming a field the type lacks', () => {
    const good = { id: 'bills', entity: 'Bill', label: 'Bills', checks: [] } as Register;
    const bad = { id: 'old', entity: 'Bill', label: 'Old', columns: ['nope'], checks: [] } as Register;
    expect(fittingRegisters({ entities: [Party, Bill], registers: [good, bad] }).map((r) => r.id)).toEqual(['bills']);
  });
});
