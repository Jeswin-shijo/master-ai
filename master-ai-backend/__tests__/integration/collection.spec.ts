import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateStaffInputSchema } from '@onehuman/schemas';
import { SYSTEM } from '../../src/audit/audit.service';
import { DbService } from '../../src/db/db.service';
import { auditEvents, calls as callsTable } from '../../src/db/schema';
import { ListsService } from '../../src/lists/lists.service';
import { RecordsService } from '../../src/records/records.service';
import { CollectionService } from '../../src/routines/collection.service';
import { newCollectState } from '../../src/voice/collect-engine';
import { RoutinesService } from '../../src/routines/routines.service';
import { TenancyService } from '../../src/tenancy/tenancy.service';
import { CallsService } from '../../src/voice/calls.service';
import { TeamService } from '../../src/voice/team.service';
import { istDate } from '../../src/voice/time';
import { boot, newOrg, type Harness, type Org } from './harness';

let h: Harness;
let a: Org;
let routines: RoutinesService;
let calls: CallsService;
let lists: ListsService;
let kaveriId: string;

beforeAll(async () => {
  h = await boot();
  a = await newOrg(h, 'wholesale-retail');
  routines = h.get(RoutinesService);
  calls = h.get(CallsService);
  lists = h.get(ListsService);
  kaveriId = await addRecord('Party', { name: 'Kaveri Spec Traders', partyType: 'retailer', phone: '+91 98470 22222' });
});
afterAll(() => h.close());

async function addRecord(entity: string, data: Record<string, unknown>): Promise<string> {
  return h.get(DbService).tenant(a.tenantId, async (tx) => {
    const svc = h.get(RecordsService);
    return (await svc.create(tx, a.tenantId, await svc.activeWorkspace(tx), entity, data, SYSTEM, { kind: 'agent' })).id;
  });
}

/** A billing clerk with today's bills routine switched on for them. */
async function clerk(name: string) {
  const person = await h.get(TeamService).create(a.session, CreateStaffInputSchema.parse({ name, phone: `+91 98470 ${Math.floor(10000 + Math.random() * 89999)}`, title: 'Billing clerk' }));
  const routine = await routines.create(a.session, { templateId: 'todays-bills', staffIds: [person.id] });
  return { person, routine };
}

/** Runs the routine now and answers the call in the simulator; returns the call id. */
async function ring(routineId: string): Promise<string> {
  const run = await routines.startRun(a.tenantId, routineId, 'manual');
  const placed = await routines.placeCall(a.tenantId, run.entryIds[0]!, 1);
  await calls.answer(a.tenantId, placed.callId!);
  return placed.callId!;
}
async function say(callId: string, replies: string[]) {
  for (const text of replies) await calls.reply(a.tenantId, callId, text);
}
const bills = async () => (await lists.page(a.tenantId, 'bills', { range: 'all' })).items;

describe('collection routines', () => {
  it('offers the template with its list and what it asks, and needs someone to call', async () => {
    const t = (await routines.templates(a.tenantId)).find((x) => x.id === 'todays-bills')!;
    expect(t).toMatchObject({ listLabel: 'Bills', collect: { list: 'bills', who: 'the billing clerk' } });
    expect(t.askLabels.length).toBe(6);
    await expect(routines.create(a.session, { templateId: 'todays-bills' })).rejects.toThrow(/Pick who the AI calls/);
  });

  it('adds the bills a clerk reads out, from the call and not checked, and counts them on the day', async () => {
    const { routine } = await clerk('Ravi Kumar');
    expect(routine.collect).toMatchObject({ list: 'bills', listLabel: 'Bills', itemLabel: 'bill', maxItems: 15 });
    const callId = await ring(routine.id);
    expect(await calls.get(a.tenantId, callId)).toMatchObject({ stage: 'collect', status: 'in_progress' });
    expect((await calls.get(a.tenantId, callId)).transcript[0]!.text).toMatch(/calling for today's bills/);
    await say(callId, ['Two', 'CS-1', 'sales invoice', 'Kaveri Spec', 'yes', '48,260', '7,360', 'skip', 'yes']);
    await say(callId, ['CS-2', 'purchase bill', 'nobody', '1 lakh 20', 'skip', 'skip', 'yes', "No, that's all"]);

    const items = (await bills()).filter((i) => ['CS-1', 'CS-2'].includes(String(i.data.billNo)));
    expect(items).toHaveLength(2);
    const one = items.find((i) => i.data.billNo === 'CS-1')!;
    expect(one.data).toMatchObject({ billType: 'sales invoice', party: kaveriId, total: 48260, gstAmount: 7360, billDate: istDate(), paymentStatus: 'unpaid' });
    expect(one.source).toMatchObject({ kind: 'call', label: 'Call with Ravi Kumar', callId });
    expect(one.checked).toBeNull();
    const two = items.find((i) => i.data.billNo === 'CS-2')!;
    expect(two.data).toMatchObject({ party: 'nobody', total: 120000 });
    expect(two.problems.map((p) => p.key)).toContain('ref:party');

    const day = await routines.day(a.tenantId, routine.id);
    expect(day.entries[0]).toMatchObject({ status: 'reported', source: 'call', values: { items: 2, differences: 0 } });
    expect(day.summary.totals).toEqual([{ key: 'items', label: 'Bills added', value: 2 }]);
    expect(await calls.get(a.tenantId, callId)).toMatchObject({ status: 'completed', outcome: 'reported', summary: 'Added 2 bills' });
    // The finished call keeps its last exchange: the clerk's last reply and the AI's closing line.
    const transcript = (await calls.get(a.tenantId, callId)).transcript;
    expect(transcript.at(-2)).toMatchObject({ speaker: 'person', text: "No, that's all" });
    expect(transcript.at(-1)!.text).toMatch(/^Thank you, Ravi\./);
  });

  it('keeps the bills confirmed before the line dropped', async () => {
    const { routine } = await clerk('Meena Iyer');
    const callId = await ring(routine.id);
    await say(callId, ['Two', 'CD-1', 'sales invoice', 'nobody', '100', 'skip', 'skip', 'yes', 'CD-2', 'sales invoice']);
    await routines.endUnanswered(a.tenantId, callId);
    const numbers = (await bills()).map((i) => i.data.billNo);
    expect(numbers).toContain('CD-1');
    expect(numbers).not.toContain('CD-2');
    expect((await routines.day(a.tenantId, routine.id)).entries[0]).toMatchObject({ status: 'reported', values: { items: 1, differences: 0 } });
    expect((await calls.get(a.tenantId, callId)).summary).toBe('Added 1 bill');
  });

  it('logs a collection call nobody answered as a collection call', async () => {
    const { routine } = await clerk('Nobody Answers');
    const run = await routines.startRun(a.tenantId, routine.id, 'manual');
    const placed = await routines.placeCall(a.tenantId, run.entryIds[0]!, 1);
    await calls.decline(a.tenantId, placed.callId!);
    const events = await h.get(DbService).tenant(a.tenantId, (tx) => tx.select().from(auditEvents).where(eq(auditEvents.refId, placed.callId!)));
    expect(events.find((e) => e.type === 'call.no_answer')?.payload).toMatchObject({ stage: 'collect' });
  });

  it('counts the newest state when a finish arrives with an older one', async () => {
    const { routine } = await clerk('Stale State');
    const callId = await ring(routine.id);
    const state = (n: number) => ({ ...newCollectState(), phase: 'confirm' as const, saved: Array.from({ length: n }, (_, i) => `r${i}`), done: n });
    await h.get(DbService).tenant(a.tenantId, async (tx) => {
      const [c] = await tx.select().from(callsTable).where(eq(callsTable.id, callId));
      await tx.update(callsTable).set({ extracted: { ...c!.extracted, collect: state(2) } }).where(eq(callsTable.id, callId));
    });
    await h.get(CollectionService).finish(a.tenantId, callId, [], state(1), 'dropped');
    expect((await routines.day(a.tenantId, routine.id)).entries[0]).toMatchObject({ values: { items: 2 } });
  });

  it('notes a difference on the bill already on the list instead of adding it again', async () => {
    const existing = await addRecord('Bill', { billNo: 'CR-1', billType: 'sales invoice', party: kaveriId, total: 48260 });
    const { routine } = await clerk('Arun Das');
    const callId = await ring(routine.id);
    await say(callId, ['One', 'CR-1', 'sales invoice', 'Kaveri Spec', 'yes', '48,600', 'skip', 'skip', 'yes', "that's all"]);
    expect((await bills()).filter((i) => i.data.billNo === 'CR-1')).toHaveLength(1);
    const { notes, item } = await lists.item(a.tenantId, 'bills', existing);
    expect(item.data.total).toBe(48260);
    expect(notes[0]).toMatchObject({ kind: 'difference', speaker: 'Arun Das', status: 'new' });
    expect(notes[0]!.said).toMatch(/^On the call on \d{1,2} \w{3}, Arun gave the total as ₹48,600$/);
    expect(notes[0]!.proposed).toEqual([expect.objectContaining({ field: 'total' })]);
    expect((await routines.day(a.tenantId, routine.id)).entries[0]!.values).toEqual({ items: 0, differences: 1 });
  });

  it('counts the bills added by hand in manual mode', async () => {
    const { person, routine } = await clerk('Divya Nair');
    const day = await routines.submit(a.session, routine.id, { staffId: person.id, values: { items: 3 } });
    expect(day.entries[0]).toMatchObject({ status: 'reported', source: 'manual', values: { items: 3, differences: 0 } });
  });

  it('adds the bills added by hand to the ones the call added, and keeps its differences', async () => {
    await addRecord('Bill', { billNo: 'CM-0', billType: 'sales invoice', party: kaveriId, total: 48260 });
    const { person, routine } = await clerk('Kiran Rao');
    const callId = await ring(routine.id);
    await say(callId, ['Three', 'CM-1', 'sales invoice', 'nobody', '100', 'skip', 'skip', 'yes']);
    await say(callId, ['CM-2', 'sales invoice', 'nobody', '200', 'skip', 'skip', 'yes']);
    await say(callId, ['CM-0', 'sales invoice', 'Kaveri Spec', 'yes', '48,600', 'skip', 'skip', 'yes', "No, that's all"]);
    const after = (await routines.day(a.tenantId, routine.id)).entries[0]!;
    expect(after).toMatchObject({ status: 'reported', source: 'call', values: { items: 2, differences: 1 } });

    const day = await routines.submit(a.session, routine.id, { staffId: person.id, values: { items: 1 } });
    expect(day.entries[0]).toMatchObject({ status: 'reported', source: 'call', values: { items: 3, differences: 1 } });
  });

  it('lets the simulated clerk add bills when nobody answers in the app', async () => {
    await h.get(TenancyService).updateSettings(a.session, { calls: { simulatorMode: 'auto' } });
    try {
      const { routine } = await clerk('Sam Joseph');
      const run = await routines.startRun(a.tenantId, routine.id, 'manual');
      const placed = await routines.placeCall(a.tenantId, run.entryIds[0]!, 1);
      expect(placed.done).toBe(true);
      const made = await h.get(DbService).tenant(a.tenantId, (tx) => tx.select().from(callsTable).where(eq(callsTable.id, placed.callId!)));
      expect(made[0]).toMatchObject({ status: 'completed', outcome: 'reported' });
      expect((await routines.day(a.tenantId, routine.id)).entries[0]!.values.items).toBe(2);
    } finally {
      await h.get(TenancyService).updateSettings(a.session, { calls: { simulatorMode: 'interactive' } });
    }
  });
});
