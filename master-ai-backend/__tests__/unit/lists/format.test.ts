import { describe, expect, it } from 'vitest';
import type { EntityDef } from '@onehuman/schemas';
import { registersOf } from '@onehuman/agent-kit';
import { csvValue, dayOf, istStamp, problemMessage, shown } from '../../../src/lists/format';

const Party: EntityDef = { name: 'Party', label: 'Party', plural_label: 'Parties', title_field: 'name', fields: [{ name: 'name', label: 'Name', type: 'string', required: true }] };
const f = (name: string, label: string, type: EntityDef['fields'][number]['type'], extra = {}) => ({ name, label, type, required: false, ...extra });
const Thing: EntityDef = {
  name: 'Thing', label: 'Thing',
  fields: [
    f('billNo', 'Bill no.', 'string'), f('party', 'Party', 'reference', { ref: 'Party' }), f('consent', 'Consent', 'boolean'),
    f('taxableValue', 'Taxable value', 'money'), f('gstAmount', 'GST amount', 'money'), f('discount', 'Discount', 'money'), f('total', 'Total', 'money'),
    f('stock', 'Stock in hand', 'integer'), f('reorderLevel', 'Reorder level', 'integer'), f('amount', 'Amount', 'money'),
    f('adminSpent', 'Admin spent', 'money'), f('receivedToDate', 'Received to date', 'money'),
    f('startDate', 'Start date', 'date'), f('endDate', 'End date', 'date'), f('dueDate', 'Due date', 'date'), f('validTill', 'Valid till', 'date'),
  ],
};
const reg = registersOf({
  entities: [Thing, Party],
  registers: [{
    id: 'things', entity: 'Thing', main: true,
    checks: [
      { missing: ['party', 'consent'] },
      { adds_up: { field: 'total', plus: ['taxableValue', 'gstAmount'], minus: ['discount'], tolerance: 1 } },
      { limit: { fields: ['stock'], min: 'reorderLevel', factor: 1 } },
      { limit: { fields: ['amount'], max: 2000, factor: 1 }, why: 'no 80G above ₹2,000 in cash' },
      { limit: { fields: ['adminSpent'], max: 'receivedToDate', factor: 0.2 } },
      { limit: { fields: ['endDate'], min: 'startDate', factor: 1 } },
      { duplicate: ['billNo', 'party'] },
      { overdue: { date: 'dueDate', grace_days: 0 } },
      { expiring: { date: 'validTill', days: 30 } },
    ],
  }],
})[0]!;
const msg = (key: string, data: Record<string, unknown>) => problemMessage(reg.checks.find((c) => c.key === key)!, data, '2026-10-14', Thing);

describe('problemMessage', () => {
  it.each([
    ['missing:party', {}, 'Party is missing'],
    ['missing:consent', {}, 'Consent is not ticked'],
    ['adds_up:total', { total: 48260, taxableValue: 40840, gstAmount: 7360 }, "Total ₹48,260 doesn't equal Taxable value + GST amount − Discount (₹48,200)"],
    ['limit:stock>=reorderLevel', { stock: 4, reorderLevel: 10 }, 'Stock in hand 4 is less than Reorder level (10)'],
    ['limit:amount<=2000', { amount: 5000 }, 'Amount ₹5,000 is more than ₹2,000 (no 80G above ₹2,000 in cash)'],
    ['limit:adminSpent<=receivedToDate', { adminSpent: 300000, receivedToDate: 1000000 }, 'Admin spent ₹3,00,000 is more than 20% of Received to date (₹2,00,000)'],
    ['limit:endDate>=startDate', { endDate: '2026-10-01', startDate: '2026-10-05' }, 'End date 1 Oct 2026 is before Start date (5 Oct 2026)'],
    ['duplicate:billNo,party', {}, 'Same Bill no., Party as another thing'],
    ['overdue:dueDate', { dueDate: '2026-10-11' }, 'Due date was 11 Oct 2026, 3 days ago'],
    ['overdue:dueDate', { dueDate: '2026-10-14' }, 'Due date was 14 Oct 2026, today'],
    ['expiring:validTill', { validTill: '2026-10-26' }, 'Valid till is in 12 days (26 Oct 2026)'],
    ['expiring:validTill', { validTill: '2026-10-14' }, 'Valid till is today'],
    ['expiring:validTill', { validTill: '2026-10-02' }, 'Valid till passed on 2 Oct 2026, 12 days ago'],
    ['ref:party', { party: 'Ganesh traders' }, `Party "Ganesh traders" isn't in your parties`],
    ['ref:party', { party: '0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11' }, 'Party points to a party that was removed'],
  ])('%s with %j', (key, data, want) => {
    expect(msg(key, data)).toBe(want);
  });
});

describe('values in words and in CSV', () => {
  it('reads the India-time day of a date-time, and nothing from what is not a date', () => {
    expect(dayOf('2026-10-14T20:00:00Z')).toBe('2026-10-15');
    expect(dayOf('2026-10-14')).toBe('2026-10-14');
    expect(dayOf('2026-13-45')).toBeNull();
    expect(dayOf('2026-02-31')).toBeNull();
    expect(dayOf('soon')).toBeNull();
    expect(istStamp('2026-10-14T20:00:00Z')).toBe('2026-10-15 01:30');
  });

  it('shows a reference by its title, and never an id', () => {
    const party = Thing.fields.find((x) => x.name === 'party')!;
    expect(shown(party, 'p1', new Map([['p1', 'Sri Ganesh Traders']]))).toBe('Sri Ganesh Traders');
    expect(shown(party, '0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11', new Map())).toBe('a removed item');
    expect(shown(Thing.fields.find((x) => x.name === 'total')!, 48260)).toBe('₹48,260');
    expect(shown(Thing.fields.find((x) => x.name === 'total')!, null)).toBe('—');
  });

  it('writes plain values for a spreadsheet', () => {
    expect(csvValue({ type: 'money' }, 48260)).toBe('48260');
    expect(csvValue({ type: 'date' }, '2026-10-14')).toBe('2026-10-14');
    expect(csvValue({ type: 'datetime' }, '2026-10-14T20:00:00Z')).toBe('2026-10-15 01:30');
    expect(csvValue({ type: 'boolean' }, false)).toBe('No');
    expect(csvValue({ type: 'reference' }, 'p1', 'Sri Ganesh Traders')).toBe('Sri Ganesh Traders');
    expect(csvValue({ type: 'reference' }, '0b9d3c55-8a1e-4f7e-9a51-2f7c3a6c1e11')).toBe('');
    expect(csvValue({ type: 'string' }, null)).toBe('');
  });
});

describe('date-times with no zone are India time', () => {
  it('keeps the day and the clock as written', () => {
    expect(dayOf('2026-10-14T23:30')).toBe('2026-10-14');
    expect(istStamp('2026-10-14T23:30')).toBe('2026-10-14 23:30');
    expect(dayOf('2026-10-14T23:30:00Z')).toBe('2026-10-15');
    expect(istStamp('2026-10-14T23:30:00+05:30')).toBe('2026-10-14 23:30');
  });
  it('reads a date field as its written day', () => {
    expect(csvValue({ type: 'date' }, '2026-10-14T23:30:00Z')).toBe('2026-10-14');
    expect(csvValue({ type: 'datetime' }, '2026-10-14T23:30:00Z')).toBe('2026-10-15 05:00');
  });
});
