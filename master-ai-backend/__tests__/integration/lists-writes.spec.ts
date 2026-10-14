import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../../src/db/db.service';
import { auditEvents } from '../../src/db/schema';
import { ListsService } from '../../src/lists/lists.service';
import { RecordsService } from '../../src/records/records.service';
import { istDate } from '../../src/voice/time';
import { boot, newOrg, type Harness, type Org } from './harness';

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

async function add(entity: string, data: Record<string, unknown>): Promise<string> {
  return h.get(DbService).tenant(a.tenantId, async (tx) => {
    const svc = h.get(RecordsService);
    const ws = await svc.activeWorkspace(tx);
    return (await svc.create(tx, a.tenantId, ws, entity, data, { id: null, kind: 'agent' }, { kind: 'agent' })).id;
  });
}
const bill = (billNo: string, extra: Record<string, unknown> = {}) => ({ billNo, billType: 'sales invoice', party: partyId, billDate: today, total: 100, ...extra });

describe('adding and correcting', () => {
  it('adds an item the owner types as checked, by hand', async () => {
    const item = await lists.create(a.session, 'parties', { name: 'Typed Traders', partyType: 'retailer', phone: '+91 98470 11111' });
    expect(item.source).toEqual({ kind: 'manual', label: 'Asha Owner, by hand' });
    expect(item.checked?.by).toBe('Asha Owner');
  });

  it("checks the item an owner corrects, and keeps the old and new values in its history", async () => {
    const id = await add('Bill', bill('E-1', { taxableValue: 40840, gstAmount: 7360, total: 48260 }));
    const item = await lists.update(a.session, 'bills', id, { data: { taxableValue: 40900 }, note: 'Typed wrong' });
    expect(item.problems.map((p) => p.key)).not.toContain('adds_up:total');
    expect(item.checked?.by).toBe('Asha Owner');
    expect(item.updated).toMatchObject({ via: 'manual', by: 'Asha Owner' });
    const { history } = await lists.item(a.tenantId, 'bills', id);
    expect(history.map((e) => [e.kind, e.who])).toEqual([['created', 'AI agent'], ['updated', 'Asha Owner']]);
    expect(history[1]).toMatchObject({ note: 'Typed wrong', changes: [{ field: 'taxableValue', label: 'Taxable value', from: '₹40,840', to: '₹40,900' }] });
  });
});

describe('checking', () => {
  it('needs a note to check an item with problems, keeps the accepted problem, and still shows a new one later', async () => {
    const id = await add('Bill', bill('K-1', { taxableValue: 100, gstAmount: 18, total: 200, dueDate: day(5), paymentStatus: 'unpaid' }));
    await expect(lists.check(a.session, 'bills', id, {})).rejects.toThrow(/Add a note/);
    const checked = await lists.check(a.session, 'bills', id, { note: "Rounded on the party's request" });
    expect(checked.checked).toMatchObject({ by: 'Asha Owner', note: "Rounded on the party's request" });
    expect(checked.problems).toEqual([expect.objectContaining({ key: 'adds_up:total', acknowledged: true })]);
    expect((await lists.page(a.tenantId, 'bills', { range: 'all', q: 'K-1', show: 'problems' })).total).toBe(0);
    // Days later the bill falls due, with nobody touching it.
    await h.owner.query(`update records set data = data || jsonb_build_object('dueDate', $2::text) where id = $1`, [id, day(-2)]);
    const later = (await lists.item(a.tenantId, 'bills', id)).item;
    expect(later.problems.map((p) => [p.key, p.acknowledged])).toEqual([['adds_up:total', true], ['overdue:dueDate', false]]);
    expect((await lists.page(a.tenantId, 'bills', { range: 'all', q: 'K-1', show: 'problems' })).total).toBe(1);
    expect((await lists.page(a.tenantId, 'bills', { range: 'all', q: 'K-1', show: 'checked' })).total).toBe(1);
  });

  it("checks only the items without problems, and ignores ids it doesn't own", async () => {
    const clean1 = await add('Party', { name: 'Bulk One', partyType: 'retailer', phone: '+91 98470 22222' });
    const clean2 = await add('Party', { name: 'Bulk Two', partyType: 'retailer', phone: '+91 98470 33333' });
    const bad = await add('Party', { name: 'Bulk Bad', partyType: 'retailer' });
    const other = await newOrg(h, 'wholesale-retail');
    const theirs = (await lists.page(other.tenantId, 'parties', { range: 'all' })).items[0]!.id;
    expect(await lists.checkMany(a.session, 'parties', [clean1, clean2, bad, theirs, randomUUID()])).toEqual({ checked: 2, skipped: 1 });
    expect((await lists.item(a.tenantId, 'parties', clean1)).item.checked?.by).toBe('Asha Owner');
    expect((await lists.item(a.tenantId, 'parties', bad)).item.checked).toBeNull();
    expect((await lists.item(other.tenantId, 'parties', theirs)).item.checked).toBeNull();
  });
});

describe('removing', () => {
  it('removes an item with a reason, keeping a full copy in the audit trail', async () => {
    const id = await add('Bill', bill('R-1', { total: 10 }));
    await lists.remove(a.session, 'bills', id, { reason: 'Entered twice' });
    await expect(lists.item(a.tenantId, 'bills', id)).rejects.toThrow(/not found/i);
    const events = await h.get(DbService).tenant(a.tenantId, (tx) => tx.select().from(auditEvents).where(eq(auditEvents.refId, id)));
    expect(events.find((e) => e.type === 'record.removed')!.payload).toMatchObject({
      reason: 'Entered twice',
      title: 'R-1',
      data: expect.objectContaining({ billNo: 'R-1', total: 10 }),
    });
  });

  // Last: it removes the sample party the other tests' bills point at.
  it('removes the sample data and nothing else', async () => {
    const before = await lists.overview(a.tenantId);
    expect(before.samples).toBeGreaterThan(0);
    const kept = await add('Party', { name: 'Kept Traders', partyType: 'retailer' });
    expect(await lists.removeSamples(a.session)).toEqual({ removed: before.samples });
    expect((await lists.overview(a.tenantId)).samples).toBe(0);
    expect((await lists.item(a.tenantId, 'parties', kept)).item.id).toBe(kept);
  });
});
