import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '../../src/common/auth';
import { SYSTEM } from '../../src/audit/audit.service';
import { DbService } from '../../src/db/db.service';
import { auditEvents, calls, doNotCall, followUpAttempts, recordNotes } from '../../src/db/schema';
import { FollowUpsService } from '../../src/follow-ups/follow-ups.service';
import { phoneKey } from '../../src/follow-ups/targets';
import { ListsService } from '../../src/lists/lists.service';
import { NotesService } from '../../src/notes/notes.service';
import { RecordsService } from '../../src/records/records.service';
import { TenancyService } from '../../src/tenancy/tenancy.service';
import { istDate } from '../../src/voice/time';
import { boot, newOrg, type Harness, type Org } from './harness';

let h: Harness;
let a: Org;
let admin: Session;
let followUps: FollowUpsService;
let kaveri: string;
let blocked: string;
let noPhone: string;
const day = (offset: number) => istDate(new Date(Date.now() + offset * 86_400_000));
const UNPAID = 'bills.unpaid-bills';

beforeAll(async () => {
  h = await boot();
  a = await newOrg(h, 'wholesale-retail');
  admin = { ...a.session, role: 'admin' };
  followUps = h.get(FollowUpsService);
  await h.get(ListsService).removeSamples(a.session);
  kaveri = await add('Party', { name: 'Kaveri Spec Traders', partyType: 'retailer', phone: '+91 98470 22222' });
  blocked = await add('Party', { name: 'Blocked Traders', partyType: 'retailer', phone: '+91 98470 33333' });
  noPhone = await add('Party', { name: 'No Phone Traders', partyType: 'retailer' });
});
afterAll(() => h.close());

const db = () => h.get(DbService);
async function add(entity: string, data: Record<string, unknown>): Promise<string> {
  return db().tenant(a.tenantId, async (tx) => {
    const svc = h.get(RecordsService);
    return (await svc.create(tx, a.tenantId, await svc.activeWorkspace(tx), entity, data, SYSTEM, { kind: 'agent' })).id;
  });
}
const bill = (billNo: string, extra: Record<string, unknown> = {}) =>
  add('Bill', { billNo, billType: 'sales invoice', party: kaveri, billDate: day(-10), dueDate: day(-3), total: 1000, paymentStatus: 'unpaid', ...extra });

/** Stands in for the call workflow's end: the call is over and the item is due again tomorrow. */
async function done(callId: string) {
  await db().tenant(a.tenantId, async (tx) => {
    const [c] = await tx.update(calls).set({ status: 'completed' }).where(eq(calls.id, callId)).returning();
    await tx.update(followUpAttempts).set({ nextDueOn: day(1) }).where(and(eq(followUpAttempts.recordId, c!.recordId!), eq(followUpAttempts.followUp, c!.followUp!)));
  });
}
/** Every item the sweep would call about now, in order. */
async function pickAll(): Promise<string[]> {
  const ids: string[] = [];
  for (let next = await followUps.pick(a.tenantId); next; next = await followUps.pick(a.tenantId)) {
    const [c] = await db().tenant(a.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, next!.callId)));
    ids.push(c!.recordId!);
    await done(next.callId);
  }
  return ids;
}

describe('switching follow-ups', () => {
  it('lets only the owner switch on calls to outside parties, and says who did', async () => {
    await expect(followUps.switch(admin, UNPAID, true)).rejects.toThrow(/Only the owner/);
    const on = await followUps.switch(a.session, UNPAID, true);
    expect(on).toMatchObject({ key: UNPAID, who: 'party', enabled: true, changedBy: 'Asha Owner', canSwitch: true });
    const forAdmin = (await followUps.forList(admin, 'bills')).find((f) => f.key === UNPAID)!;
    expect(forAdmin).toMatchObject({ enabled: true, canSwitch: false });
    const events = await db().tenant(a.tenantId, (tx) => tx.select().from(auditEvents).where(eq(auditEvents.type, 'followup.switched')));
    expect(events.at(-1)?.payload).toMatchObject({ key: UNPAID, enabled: true });
  });

  it('keeps the sweep schedule in step: on while any follow-up is on', async () => {
    const syncs = () => h.temporal.filter((t) => t.method === 'syncFollowUpSchedule').map((t) => t.args[0]);
    expect(syncs().at(-1)).toEqual({ tenantId: a.tenantId, active: true });
    await followUps.switch(a.session, UNPAID, false);
    expect(syncs().at(-1)).toEqual({ tenantId: a.tenantId, active: false });
    await followUps.switch(a.session, UNPAID, true);
  });

  it('starts a sweep on "Call now"', async () => {
    await followUps.runNow(a.session);
    expect(h.temporal.at(-1)).toEqual({ method: 'startFollowUpSweep', args: [{ tenantId: a.tenantId, trigger: 'manual' }] });
  });
});

describe('picking what to call about', () => {
  it('picks due items one at a time, and skips do-not-call, not yet due, waiting and new-note items', async () => {
    const due1 = await bill('P-1');
    await bill('P-2', { dueDate: day(5) });
    await bill('P-3', { paymentStatus: 'paid' });
    const later = await bill('P-4');
    const waiting = await bill('P-5');
    const noted = await bill('P-6');
    await bill('P-7', { party: blocked });
    const due2 = await bill('P-8');
    await db().tenant(a.tenantId, async (tx) => {
      await tx.insert(followUpAttempts).values([
        { tenantId: a.tenantId, recordId: later, followUp: UNPAID, nextDueOn: day(1) },
        { tenantId: a.tenantId, recordId: waiting, followUp: UNPAID, nextDueOn: day(0), state: 'waiting_for_you' },
      ]);
      await h.get(NotesService).create(tx, a.tenantId, { recordId: noted, callId: null, followUp: UNPAID, kind: 'promise', speaker: 'Kaveri Spec Traders', said: 'Friday', promiseOn: day(2) });
      await tx.insert(doNotCall).values({ tenantId: a.tenantId, phone: phoneKey('+91 98470 33333'), reason: 'asked' });
    });

    const first = (await followUps.pick(a.tenantId))!;
    expect(await followUps.pick(a.tenantId)).toBeNull(); // one call at a time
    const [call] = await db().tenant(a.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, first.callId)));
    expect(call).toMatchObject({
      stage: 'chase',
      status: 'scheduled',
      attempt: 1,
      staffId: null,
      contactName: 'Kaveri Spec Traders',
      contactPhone: '+91 98470 22222',
      recordId: due1,
      followUp: UNPAID,
      extracted: { about: { listId: 'bills', itemId: due1, title: 'P-1' } },
    });
    await done(first.callId);
    expect(await pickAll()).toEqual([due2]);
  });

  it('stops an item with no phone number, with a note for the head', async () => {
    const id = await bill('NP-1', { party: noPhone });
    expect(await pickAll()).toEqual([]);
    const [attempt] = await db().tenant(a.tenantId, (tx) => tx.select().from(followUpAttempts).where(eq(followUpAttempts.recordId, id)));
    expect(attempt?.state).toBe('stopped');
    const [note] = await db().tenant(a.tenantId, (tx) => tx.select().from(recordNotes).where(eq(recordNotes.recordId, id)));
    expect(note).toMatchObject({ kind: 'unreachable', status: 'new', said: 'There is no phone number to call No Phone Traders about NP-1. Please add one or follow it up yourself.' });
  });

  it('calls nobody outside calling hours, past the daily cap, or while the company is paused', async () => {
    const tenancy = h.get(TenancyService);
    await bill('H-1');
    await tenancy.updateSettings(a.session, { calls: { fastSchedule: false, partyHours: { days: [1, 2, 3, 4, 5, 6], start: '00:00', end: '00:01' } } });
    expect(await followUps.pick(a.tenantId)).toBeNull();
    await tenancy.updateSettings(a.session, { calls: { fastSchedule: true } });

    const made = await db().tenant(a.tenantId, (tx) => tx.select().from(calls).where(eq(calls.stage, 'chase')));
    await tenancy.updateSettings(a.session, { calls: { followUpsPerDay: made.length } });
    expect(await followUps.pick(a.tenantId)).toBeNull();
    await tenancy.updateSettings(a.session, { calls: { followUpsPerDay: 30 } });

    const ws = await db().tenant(a.tenantId, (tx) => h.get(RecordsService).activeWorkspace(tx));
    await tenancy.setWorkspacePaused(a.session, ws.id, true);
    expect(await followUps.pick(a.tenantId)).toBeNull();
    await tenancy.setWorkspacePaused(a.session, ws.id, false);
    await tenancy.setTenantPaused(a.session, true);
    expect(await followUps.pick(a.tenantId)).toBeNull();
    await tenancy.setTenantPaused(a.session, false);
    const resumed = await followUps.pick(a.tenantId);
    expect(resumed).not.toBeNull();
    await done(resumed!.callId);
  });

  it('does not let a call stuck for over half an hour block the others', async () => {
    await db().tenant(a.tenantId, (tx) =>
      tx.insert(calls).values({
        tenantId: a.tenantId,
        stage: 'chase',
        attempt: 1,
        status: 'ringing',
        provider: 'simulator',
        contactName: 'Stuck',
        contactPhone: '+91 98470 99999',
        followUp: UNPAID,
        createdAt: new Date(Date.now() - 31 * 60_000),
      }),
    );
    await bill('S-1');
    const next = await followUps.pick(a.tenantId);
    expect(next).not.toBeNull();
    await done(next!.callId);
  });

  it('counts what each follow-up would call about, waits on you for, and has stopped', async () => {
    const info = async () => (await followUps.forList(a.session, 'bills')).find((f) => f.key === UNPAID)!;
    const before = await info();
    expect(before.waiting).toBeGreaterThanOrEqual(1);
    expect(before.stopped).toBeGreaterThanOrEqual(1);
    const id = await bill('C-1');
    expect((await info()).due).toBe(before.due + 1);
    await db().tenant(a.tenantId, (tx) =>
      h.get(NotesService).create(tx, a.tenantId, { recordId: id, callId: null, followUp: UNPAID, kind: 'said', speaker: 'Kaveri', said: 'Will pay soon' }),
    );
    expect((await info()).due).toBe(before.due);
  });

  it('does not ring the same item again today when its call ended without being finished', async () => {
    await pickAll();
    const id = await bill('R-1');
    const first = (await followUps.pick(a.tenantId))!;
    const [c] = await db().tenant(a.tenantId, (tx) => tx.update(calls).set({ status: 'completed' }).where(eq(calls.id, first.callId)).returning());
    expect(c!.recordId).toBe(id);
    const events = await db().tenant(a.tenantId, (tx) => tx.select().from(auditEvents).where(and(eq(auditEvents.type, 'call.scheduled'), eq(auditEvents.refId, first.callId))));
    expect(events[0]?.payload).toMatchObject({ staffName: 'Kaveri Spec Traders', stage: 'chase', followUp: UNPAID, title: expect.stringContaining('R-1') });
    expect(await followUps.pick(a.tenantId)).toBeNull();
  });

  it('never calls about sample items', async () => {
    const dueNow = async () => (await followUps.forList(a.session, 'bills')).find((f) => f.key === UNPAID)!.due;
    const before = await dueNow();
    const sample = await db().tenant(a.tenantId, async (tx) => {
      const svc = h.get(RecordsService);
      const data = { billNo: 'SAMPLE-1', billType: 'sales invoice', party: kaveri, billDate: day(-10), dueDate: day(-3), total: 1000, paymentStatus: 'unpaid' };
      return (await svc.create(tx, a.tenantId, await svc.activeWorkspace(tx), 'Bill', data, SYSTEM, { kind: 'sample' })).id;
    });
    expect(await pickAll()).not.toContain(sample);
    expect(await dueNow()).toBe(before);
  });
});
