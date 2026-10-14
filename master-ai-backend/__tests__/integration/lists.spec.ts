import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MANAGERS_ONLY } from '../../src/common/auth';
import { DbService } from '../../src/db/db.service';
import { ListsController } from '../../src/lists/lists.controller';
import { ListsService } from '../../src/lists/lists.service';
import { rangeDays } from '../../src/lists/query';
import { RecordsService } from '../../src/records/records.service';
import { istDate } from '../../src/voice/time';
import { boot, newOrg, type Harness, type Org } from './harness';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
let h: Harness;
let a: Org;
let lists: ListsService;
let partyId: string;
const today = istDate();
const day = (offset: number) => istDate(new Date(Date.now() + offset * 86_400_000));

beforeAll(async () => {
  h = await boot();
  a = await newOrg(h, 'wholesale-retail');
  lists = h.get(ListsService);
  partyId = (await lists.page(a.tenantId, 'parties', { range: 'all' })).items[0]!.id;
});
afterAll(() => h.close());

/** Adds an item the way an AI agent would, so nobody has checked it. */
async function add(entity: string, data: Record<string, unknown>): Promise<string> {
  return h.get(DbService).tenant(a.tenantId, async (tx) => {
    const svc = h.get(RecordsService);
    const ws = await svc.activeWorkspace(tx);
    return (await svc.create(tx, a.tenantId, ws, entity, data, { id: null, kind: 'agent' }, { kind: 'agent' })).id;
  });
}
const problems = async (list: string, id: string) => (await lists.item(a.tenantId, list, id)).item.problems;
const keys = async (list: string, id: string) => (await problems(list, id)).map((p) => p.key);
const bill = (billNo: string, extra: Record<string, unknown> = {}) => ({ billNo, billType: 'sales invoice', party: partyId, billDate: today, total: 100, ...extra });

describe('who sees lists', () => {
  it('is the owner and admins only', () => {
    expect(Reflect.getMetadata(MANAGERS_ONLY, ListsController)).toBe(true);
  });
});

describe('the Lists page', () => {
  it("shows the organization type's main lists as cards, with what each card counts", async () => {
    const o = await lists.overview(a.tenantId);
    expect(o.lists.filter((l) => l.main).map((l) => l.id)).toEqual(['bills', 'orders', 'parties', 'products']);
    const bills = o.lists.find((l) => l.id === 'bills')!;
    expect(bills.card).toMatchObject({ countLabel: 'this month', sumField: 'total', sumLabel: 'unpaid' });
    expect(bills.card.notChecked).toBeGreaterThan(0);
    expect(o.lists.filter((l) => !l.main).map((l) => l.id)).toEqual(expect.arrayContaining(['customer', 'enquiry']));
    expect(o.samples).toBeGreaterThan(0);
  });

  it('opens Lists for a company saved before lists existed, with a default list per record type', async () => {
    const old = await newOrg(h, 'wholesale-retail');
    await h.owner.query(`update workspaces set pack = pack - 'registers' where id = $1`, [old.workspaceId]);
    const o = await lists.overview(old.tenantId);
    expect(o.lists.every((l) => !l.explicit)).toBe(true);
    expect(o.lists.map((l) => l.id)).toEqual(expect.arrayContaining(['bill', 'party', 'product', 'order']));
  });
});

describe('checks', () => {
  it('finds a bill whose total does not add up, and not one with a part missing', async () => {
    const bad = await add('Bill', bill('A-1', { taxableValue: 40840, gstAmount: 7360, total: 48260 }));
    const partial = await add('Bill', bill('A-2', { gstAmount: 7360, total: 48260 }));
    expect(await problems('bills', bad)).toContainEqual({ key: 'adds_up:total', message: "Total ₹48,260 doesn't equal Taxable value + GST amount (₹48,200)", acknowledged: false });
    expect(await keys('bills', partial)).not.toContain('adds_up:total');
  });

  it('finds missing details, and a party that is not in Parties', async () => {
    const noParty = await add('Bill', { billNo: 'A-3', billType: 'sales invoice', billDate: today, total: 100 });
    const unknown = await add('Bill', bill('A-4', { party: 'Ganesh traders' }));
    expect(await keys('bills', noParty)).toContain('missing:party');
    expect(await problems('bills', unknown)).toContainEqual(expect.objectContaining({ key: 'ref:party', message: `Party "Ganesh traders" isn't in your parties` }));
  });

  it('flags both copies of a duplicate and links each to the other', async () => {
    const one = await add('Bill', bill('D-1'));
    const two = await add('Bill', bill('D-1'));
    const credit = await add('Bill', bill('D-1', { billType: 'credit note' }));
    const dup = async (id: string) => (await problems('bills', id)).find((p) => p.key === 'duplicate:billType,billNo,party');
    expect((await dup(one))?.relatedId).toBe(two);
    expect((await dup(two))?.relatedId).toBe(one);
    expect(await dup(credit)).toBeUndefined();
  });

  it('finds an unpaid bill past its due date, counted in India days', async () => {
    const late = await add('Bill', bill('O-1', { dueDate: day(-3), paymentStatus: 'unpaid' }));
    const paid = await add('Bill', bill('O-2', { dueDate: day(-3), paymentStatus: 'paid' }));
    expect((await problems('bills', late)).find((p) => p.key === 'overdue:dueDate')?.message).toMatch(/, 3 days ago$/);
    expect(await keys('bills', paid)).not.toContain('overdue:dueDate');
  });

  it('finds a party over its credit limit, and stock below its reorder level', async () => {
    const over = await add('Party', { name: 'Over Ltd', partyType: 'retailer', phone: '+91 98470 00000', creditLimit: 50000, outstanding: 60000 });
    const under = await add('Party', { name: 'Under Ltd', partyType: 'retailer', phone: '+91 98470 00001', creditLimit: 50000, outstanding: 10000 });
    expect(await keys('parties', over)).toContain('limit:outstanding<=creditLimit');
    expect(await keys('parties', under)).not.toContain('limit:outstanding<=creditLimit');
    const low = await add('Product', { name: 'Low stock item', stock: 4, reorderLevel: 10 });
    expect((await problems('products', low)).map((p) => p.message)).toContain('Stock in hand 4 is less than Reorder level (10)');
  });

  it('finds stock that expires within 30 days or has already expired, and not stock that expires later', async () => {
    const soon = await add('Product', { name: 'Soon', nearestExpiry: day(12) });
    const gone = await add('Product', { name: 'Gone', nearestExpiry: day(-12) });
    const later = await add('Product', { name: 'Later', nearestExpiry: day(60) });
    expect((await problems('products', soon)).map((p) => p.message)).toContainEqual(expect.stringMatching(/is in 12 days/));
    expect((await problems('products', gone)).map((p) => p.message)).toContainEqual(expect.stringMatching(/passed on .*, 12 days ago/));
    expect(await keys('products', later)).not.toContain('expiring:nearestExpiry');
  });

  it('treats a stored value that is not a number or a date as blank, so the list still opens', async () => {
    const id = await add('Bill', bill('M-1', { dueDate: day(5) }));
    await h.owner.query(`update records set data = data || '{"total":"abc","dueDate":"2026-13-45"}'::jsonb where id = $1`, [id]);
    const page = await lists.page(a.tenantId, 'bills', { range: 'all', q: 'M-1', sort: 'total:asc' });
    expect(page.items.map((i) => i.id)).toEqual([id]);
    expect(page.totals.total).toBe(0);
    expect(page.items[0]!.problems.map((p) => p.key)).not.toContain('overdue:dueDate');
  });
});

describe('a list page', () => {
  it('totals every matching item, not only the page shown', async () => {
    for (let i = 0; i < 60; i++) await add('Bill', bill(`PG-${i}`));
    const first = await lists.page(a.tenantId, 'bills', { range: 'all', q: 'PG-' });
    expect(first).toMatchObject({ total: 60, page: 1, pageSize: 50 });
    expect(first.items).toHaveLength(50);
    expect(first.totals.total).toBe(6000);
    expect((await lists.page(a.tenantId, 'bills', { range: 'all', q: 'PG-', page: '2' })).items).toHaveLength(10);
  });

  it('filters by date range, choice and how it came in, and counts items with no date', async () => {
    const lastMonth = rangeDays('last_month', today)!.from;
    await add('Bill', bill('RG-1'));
    await add('Bill', bill('RG-2', { billDate: lastMonth }));
    await add('Bill', bill('RG-3', { billDate: undefined }));
    const page = (raw: Record<string, string>) => lists.page(a.tenantId, 'bills', { q: 'RG-', ...raw });
    const opened = await page({});
    expect(opened.items.map((i) => i.data.billNo)).toEqual(['RG-1']);
    expect(opened.undated).toBe(1);
    expect((await page({ range: 'last_month' })).items.map((i) => i.data.billNo)).toEqual(['RG-2']);
    expect((await page({ range: 'all' })).total).toBe(3);
    expect((await page({ from: lastMonth, to: today })).total).toBe(2);
    expect((await page({ range: 'all', 'f.billType': 'credit note' })).total).toBe(0);
    expect((await page({ range: 'all', source: 'agent' })).total).toBe(3);
    expect((await page({ range: 'all', source: 'manual' })).total).toBe(0);
  });

  it('searches for the text as typed, so % and _ are not wildcards', async () => {
    await add('Bill', bill('50%_OFF'));
    await add('Bill', bill('50XYOFF'));
    expect((await lists.page(a.tenantId, 'bills', { range: 'all', q: '50%_' })).items.map((i) => i.data.billNo)).toEqual(['50%_OFF']);
  });

  it('says how each item came in, and shows references by their title', async () => {
    const sample = (await lists.page(a.tenantId, 'parties', { range: 'all', source: 'sample' })).items[0]!;
    expect(sample.source).toEqual({ kind: 'sample', label: 'Sample data' });
    const id = await add('Bill', bill('T-1'));
    const { item, history } = await lists.item(a.tenantId, 'bills', id);
    expect(item.source).toEqual({ kind: 'agent', label: 'AI agent' });
    expect(item.titles.party).toBe((await lists.page(a.tenantId, 'parties', { range: 'all' })).items.find((p) => p.id === partyId)!.title);
    expect(history.map((e) => [e.kind, e.who])).toEqual([['created', 'AI agent']]);
  });

  it("never shows another company's items", async () => {
    const other = await newOrg(h, 'wholesale-retail');
    const id = await add('Bill', bill('ISO-1'));
    expect((await lists.page(other.tenantId, 'bills', { range: 'all', q: 'ISO-1' })).total).toBe(0);
    await expect(lists.item(other.tenantId, 'bills', id)).rejects.toThrow(/not found/i);
  });

  it('downloads the filtered list as CSV, with titles and never ids', async () => {
    const partyTitle = (await lists.page(a.tenantId, 'parties', { range: 'all' })).items.find((p) => p.id === partyId)!.title;
    const csv = await lists.exportCsv(a.tenantId, 'bills', { range: 'all', q: 'A-1' });
    expect(csv.startsWith('﻿Bill no.,Type,Party,Bill date')).toBe(true);
    expect(csv).toContain(`A-1,sales invoice,${partyTitle},`);
    expect(csv).not.toMatch(UUID);
  });
});
