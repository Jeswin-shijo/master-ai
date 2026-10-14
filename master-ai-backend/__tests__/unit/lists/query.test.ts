import { describe, expect, it } from 'vitest';
import type { EntityDef } from '@onehuman/schemas';
import { registersOf } from '@onehuman/agent-kit';
import { parseListQuery, rangeDays } from '../../../src/lists/query';

const Bill: EntityDef = {
  name: 'Bill', label: 'Bill',
  fields: [
    { name: 'billNo', label: 'Bill no.', type: 'string', required: true },
    { name: 'billType', label: 'Type', type: 'enum', required: true, options: ['sales invoice', 'credit note'] },
    { name: 'paid', label: 'Paid', type: 'boolean', required: false },
    { name: 'billDate', label: 'Bill date', type: 'date', required: false },
    { name: 'total', label: 'Total', type: 'money', required: false },
  ],
};
const Party: EntityDef = { name: 'Party', label: 'Party', fields: [{ name: 'name', label: 'Name', type: 'string', required: true }] };
const [bills, party] = registersOf({ entities: [Bill, Party], registers: [{ id: 'bills', entity: 'Bill', main: true, date_field: 'billDate', checks: [] }] });

describe('rangeDays (India calendar days)', () => {
  it.each([
    ['today', { from: '2026-10-14', to: '2026-10-14' }],
    ['this_week', { from: '2026-10-12', to: '2026-10-18' }],
    ['this_month', { from: '2026-10-01', to: '2026-10-31' }],
    ['last_month', { from: '2026-09-01', to: '2026-09-30' }],
    ['all', null],
  ] as const)('%s around Wednesday 14 Oct 2026', (range, want) => {
    expect(rangeDays(range, '2026-10-14')).toEqual(want);
  });

  it('crosses a year, and starts a week on Monday even on a Sunday', () => {
    expect(rangeDays('last_month', '2026-01-05')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(rangeDays('this_week', '2026-10-18')).toEqual({ from: '2026-10-12', to: '2026-10-18' });
  });
});

describe('parseListQuery', () => {
  it('opens a dated list on this month, and a list without a date on everything', () => {
    expect(parseListQuery({}, bills!, '2026-10-14').dates).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(parseListQuery({ range: 'this_month' }, party!, '2026-10-14').dates).toBeNull();
  });

  it('takes a custom range of two days', () => {
    expect(parseListQuery({ from: '2026-09-01', to: '2026-09-15' }, bills!, '2026-10-14').dates).toEqual({ from: '2026-09-01', to: '2026-09-15' });
    expect(() => parseListQuery({ from: '2026-09-15', to: '2026-09-01' }, bills!, '2026-10-14')).toThrow(/YYYY-MM-DD/);
    expect(() => parseListQuery({ from: '2026-09-15' }, bills!, '2026-10-14')).toThrow(/YYYY-MM-DD/);
  });

  it("takes only this list's filters and their choices", () => {
    const q = parseListQuery({ 'f.billType': 'credit note', 'f.paid': 'true', range: 'all' }, bills!, '2026-10-14');
    expect(q.filters.map((f) => [f.field.name, f.value])).toEqual([['billType', 'credit note'], ['paid', 'true']]);
    expect(() => parseListQuery({ 'f.total': '5' }, bills!, '2026-10-14')).toThrow(/not a filter/);
    expect(() => parseListQuery({ 'f.billType': 'refund' }, bills!, '2026-10-14')).toThrow(/not a choice/);
    expect(() => parseListQuery({ 'f.paid': 'maybe' }, bills!, '2026-10-14')).toThrow(/true or false/);
  });

  it('reads sort, page, search, source and show, refusing anything else', () => {
    const q = parseListQuery({ sort: 'total:asc', page: '3', q: '  S-10  ', source: 'agent', show: 'problems' }, bills!, '2026-10-14');
    expect(q).toMatchObject({ page: 3, q: 'S-10', source: 'agent', show: 'problems' });
    expect([q.sort.field?.name, q.sort.dir]).toEqual(['total', 'asc']);
    expect(parseListQuery({ page: 'x' }, bills!, '2026-10-14').page).toBe(1);
    expect(() => parseListQuery({ sort: 'nope:asc' }, bills!, '2026-10-14')).toThrow(/sort/);
    expect(() => parseListQuery({ source: 'email' }, bills!, '2026-10-14')).toThrow(/source/);
    expect(() => parseListQuery({ show: 'everything' }, bills!, '2026-10-14')).toThrow(/show/);
    expect(() => parseListQuery({ range: 'forever' }, bills!, '2026-10-14')).toThrow(/range/);
  });
});
