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

  it('searches the values people see, not field names, ids or JSON quoting', async () => {
    const quoted = await add('Party', { name: 'Sri "Ganesh" Traders', partyType: 'retailer', phone: '+91 98470 00002' });
    const found = await lists.page(a.tenantId, 'parties', { range: 'all', q: '"Ganesh"' });
    expect(found.items.map((i) => i.id)).toEqual([quoted]);
    const noTax = await add('Bill', bill('TX-1'));
    const tax = (await lists.page(a.tenantId, 'bills', { range: 'all', q: 'tax' })).items.map((i) => i.id);
    expect(tax).not.toContain(noTax);
    const byParty = await add('Bill', bill('BP-1', { party: quoted }));
    const viaParty = await lists.page(a.tenantId, 'bills', { range: 'all', q: 'ganesh' });
    expect(viaParty.items.map((i) => i.id)).toEqual([byParty]);
    expect((await lists.page(a.tenantId, 'bills', { range: 'all', q: quoted.slice(0, 8) })).total).toBe(0);
  });

  it('reads an offset-less date-time as India time in SQL, and one with an offset as given', async () => {
    const { rows } = await h.owner.query(
      `select (try_timestamptz('2026-10-14T23:30') at time zone 'Asia/Kolkata')::date::text as a, (try_timestamptz('2026-10-14T23:30:00Z') at time zone 'Asia/Kolkata')::date::text as b`,
    );
    expect(rows[0]).toEqual({ a: '2026-10-14', b: '2026-10-15' });
  });

  it('puts a date-time with no offset on its India day', async () => {
    await add('Order', { customerName: 'Late Co', items: '1 box', amount: 100, status: 'new', orderedAt: `${today}T23:30` });
    const page = await lists.page(a.tenantId, 'orders', { range: 'today' });
    expect(page.items.some((i) => i.data.orderedAt === `${today}T23:30`)).toBe(true);
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

/** Adds an item to another organization's list the way an AI agent would. */
async function addTo(org: Org, entity: string, data: Record<string, unknown>): Promise<string> {
  return h.get(DbService).tenant(org.tenantId, async (tx) => {
    const svc = h.get(RecordsService);
    const ws = await svc.activeWorkspace(tx);
    return (await svc.create(tx, org.tenantId, ws, entity, data, { id: null, kind: 'agent' }, { kind: 'agent' })).id;
  });
}
const keysIn = async (org: Org, list: string, id: string) => (await lists.item(org.tenantId, list, id)).item.problems.map((p) => p.key);
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

// Spec §9: the SQL that decides what is a problem runs on Postgres, one positive and one negative item per variant.
describe('every kind of check, in SQL', () => {
  it('limit with a factor: admin costs up to 20% of what was received, for foreign money only', async () => {
    const ngo = await newOrg(h, 'ngo');
    const grant = (code: string, extra: Record<string, unknown>) =>
      addTo(ngo, 'Grant', { grantCode: code, donorName: 'Donor', donorType: 'foreign', status: 'active', receivedToDate: 1_000_000, ...extra });
    const over = await grant('G-1', { isForeign: true, adminSpent: 300_000 });
    const within = await grant('G-2', { isForeign: true, adminSpent: 100_000 });
    const notForeign = await grant('G-3', { isForeign: false, adminSpent: 300_000 });
    const key = 'limit:adminSpent<=receivedToDate';
    expect(await keysIn(ngo, 'grants', over)).toContain(key);
    expect(await keysIn(ngo, 'grants', within)).not.toContain(key);
    expect(await keysIn(ngo, 'grants', notForeign)).not.toContain(key);
  });

  it('when a number is above a value: the e-way bill is needed above ₹50,000', async () => {
    const lg = await newOrg(h, 'logistics');
    const ship = (lr: string, extra: Record<string, unknown>) =>
      addTo(lg, 'Shipment', { lrNumber: lr, consignorName: 'Sender', fromCity: 'Kochi', toCity: 'Pune', status: 'booked', ...extra });
    const big = await ship('LR-1', { declaredValue: 60_000 });
    const small = await ship('LR-2', { declaredValue: 40_000 });
    expect(await keysIn(lg, 'shipments', big)).toContain('missing:ewayBillNumber');
    expect(await keysIn(lg, 'shipments', small)).not.toContain('missing:ewayBillNumber');
  });

  it('when a field is filled: a signed report needs its UDIN once signed', async () => {
    const ca = await newOrg(h, 'accounting-firm');
    const report = (extra: Record<string, unknown>) =>
      addTo(ca, 'SignedReport', { client: 'Client Ltd', documentType: 'tax-audit-report', signingPartner: 'Partner', signedOn: day(-2), ...extra });
    const signed = await report({});
    const unsigned = await report({});
    await h.owner.query(`update records set data = data - 'signedOn' where id = $1`, [unsigned]);
    expect(await keysIn(ca, 'signed-reports', signed)).toContain('missing:udin');
    expect(await keysIn(ca, 'signed-reports', unsigned)).not.toContain('missing:udin');
  });

  it('a yes/no field counts as missing when it is not true', async () => {
    const pp = await newOrg(h, 'power-plant');
    const permit = (no: string, extra: Record<string, unknown>) =>
      addTo(pp, 'WorkPermit', { permitNo: no, permitType: 'confined-space', equipment: 'Boiler', status: 'requested', ...extra });
    const unset = await permit('WP-1', {});
    const no = await permit('WP-2', { gasTestOk: false });
    const yes = await permit('WP-3', { gasTestOk: true });
    expect(await keysIn(pp, 'work-permits', unset)).toContain('missing:gasTestOk');
    expect(await keysIn(pp, 'work-permits', no)).toContain('missing:gasTestOk');
    expect(await keysIn(pp, 'work-permits', yes)).not.toContain('missing:gasTestOk');
  });

  it('a date against another date: the trip cannot end before it starts', async () => {
    const tr = await newOrg(h, 'travel-agency');
    const trip = (extra: Record<string, unknown>) => addTo(tr, 'Trip', { travellerName: 'Asha', destination: 'Goa', status: 'planning', ...extra });
    const backwards = await trip({ startDate: day(10), endDate: day(5) });
    const forwards = await trip({ startDate: day(5), endDate: day(10) });
    expect(await keysIn(tr, 'trips', backwards)).toContain('limit:endDate>=startDate');
    expect(await keysIn(tr, 'trips', forwards)).not.toContain('limit:endDate>=startDate');
  });

  it('a date-time is overdue once past, and only while its when holds', async () => {
    const pp = await newOrg(h, 'power-plant');
    const permit = (no: string, extra: Record<string, unknown>) =>
      addTo(pp, 'WorkPermit', { permitNo: no, permitType: 'mechanical', equipment: 'Pump', ...extra });
    const late = await permit('WP-10', { status: 'issued', validTill: hours(-48) });
    const live = await permit('WP-11', { status: 'issued', validTill: hours(48) });
    const returned = await permit('WP-12', { status: 'returned', validTill: hours(-48) });
    expect(await keysIn(pp, 'work-permits', late)).toContain('overdue:validTill');
    expect(await keysIn(pp, 'work-permits', live)).not.toContain('overdue:validTill');
    expect(await keysIn(pp, 'work-permits', returned)).not.toContain('overdue:validTill');
  });

  it('a date-time is expiring within its days, and not when further out', async () => {
    const lg = await newOrg(h, 'logistics');
    const ship = (lr: string, extra: Record<string, unknown>) =>
      addTo(lg, 'Shipment', { lrNumber: lr, consignorName: 'Sender', fromCity: 'Kochi', toCity: 'Pune', status: 'in-transit', ...extra });
    const soon = await ship('LR-10', { ewayBillValidUntil: hours(12) });
    const later = await ship('LR-11', { ewayBillValidUntil: hours(5 * 24) });
    expect(await keysIn(lg, 'shipments', soon)).toContain('expiring:ewayBillValidUntil');
    expect(await keysIn(lg, 'shipments', later)).not.toContain('expiring:ewayBillValidUntil');
  });

  describe('kinds no ready-made type uses, on a list added to the snapshot', () => {
    let org: Org;
    const mine = (billNo: string, extra: Record<string, unknown>) => addTo(org, 'Bill', bill(billNo, extra));
    beforeAll(async () => {
      org = await newOrg(h, 'wholesale-retail');
      const extra = {
        id: 'bill-kinds', entity: 'Bill', label: 'Bill kinds', main: false,
        checks: [
          { adds_up: { field: 'total', plus: ['taxableValue', 'gstAmount'], minus: [], tolerance: 100 } },
          { missing: ['dueDate'], when: { total: { below: 50 } } },
          { missing: ['paymentStatus'], when: { dueDate: 'blank' } },
        ],
      };
      await h.owner.query(`update workspaces set pack = jsonb_set(pack, '{registers}', coalesce(pack->'registers', '[]'::jsonb) || $2::jsonb) where id = $1`, [org.workspaceId, JSON.stringify([extra])]);
    });

    it('adds_up with a tolerance above 1: a difference inside it is fine', async () => {
      const inside = await mine('T-1', { taxableValue: 1000, gstAmount: 180, total: 1130 });
      const outside = await mine('T-2', { taxableValue: 1000, gstAmount: 180, total: 1030 });
      expect(await keysIn(org, 'bill-kinds', inside)).not.toContain('adds_up:total');
      expect(await keysIn(org, 'bill-kinds', outside)).toContain('adds_up:total');
    });

    it('when a number is below a value', async () => {
      const small = await mine('B-1', { total: 40, paymentStatus: 'unpaid' });
      const big = await mine('B-2', { total: 60, paymentStatus: 'unpaid' });
      expect(await keysIn(org, 'bill-kinds', small)).toContain('missing:dueDate');
      expect(await keysIn(org, 'bill-kinds', big)).not.toContain('missing:dueDate');
    });

    it('when a field is blank', async () => {
      const noDue = await mine('K-1', { total: 100 });
      const due = await mine('K-2', { total: 100, dueDate: day(5) });
      expect(await keysIn(org, 'bill-kinds', noDue)).toContain('missing:paymentStatus');
      expect(await keysIn(org, 'bill-kinds', due)).not.toContain('missing:paymentStatus');
    });
  });
});
