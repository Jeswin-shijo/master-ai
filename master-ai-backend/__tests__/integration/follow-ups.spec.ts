import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Session } from '../../src/common/auth';
import { CreateStaffInputSchema } from '@onehuman/schemas';
import { SYSTEM } from '../../src/audit/audit.service';
import { DbService } from '../../src/db/db.service';
import { auditEvents, calls, doNotCall, followUpAttempts, recordNotes, tenants } from '../../src/db/schema';
import { FollowUpCallsService } from '../../src/follow-ups/follow-up-calls.service';
import { FollowUpsService } from '../../src/follow-ups/follow-ups.service';
import { phoneKey } from '../../src/follow-ups/targets';
import { ListsService } from '../../src/lists/lists.service';
import { NotesService } from '../../src/notes/notes.service';
import { RecordsService } from '../../src/records/records.service';
import { TenancyService } from '../../src/tenancy/tenancy.service';
import { CallsService } from '../../src/voice/calls.service';
import { TeamService } from '../../src/voice/team.service';
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
async function done(callId: string, tenantId = a.tenantId) {
  await db().tenant(tenantId, async (tx) => {
    const [c] = await tx.update(calls).set({ status: 'completed' }).where(eq(calls.id, callId)).returning();
    await tx.update(followUpAttempts).set({ nextDueOn: day(1) }).where(and(eq(followUpAttempts.recordId, c!.recordId!), eq(followUpAttempts.followUp, c!.followUp!)));
  });
}
/** As if the next day had come: today's follow-up calls move back a day, so each number and team member may be called again. */
async function nextDay(tenantId = a.tenantId) {
  await db().tenant(tenantId, (tx) =>
    tx
      .update(calls)
      .set({ createdAt: sql`${calls.createdAt} - interval '1 day'` })
      .where(and(eq(calls.stage, 'chase'), sql`(${calls.createdAt} at time zone 'Asia/Kolkata')::date = ${istDate()}::date`)),
  );
}
/** Calls about everything due, a day at a time, until nothing is left; then starts a fresh day. */
async function drain() {
  do await nextDay();
  while ((await pickAll()).length);
  await nextDay();
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
    expect(await pickAll()).toEqual([]); // due2 is the same party's: not called again today
    await nextDay();
    expect(await pickAll()).toEqual([due2]);
  });

  it('calls each number at most once a day, about one item', async () => {
    const two = await add('Party', { name: 'Two Bills Traders', partyType: 'retailer', phone: '+91 98470 77777' });
    const one = await add('Party', { name: 'One Bill Traders', partyType: 'retailer', phone: '+91 98470 88888' });
    const twoA = await bill('D-1', { party: two });
    const twoB = await bill('D-2', { party: two });
    const oneA = await bill('D-3', { party: one });
    expect(await pickAll()).toEqual([twoA, oneA]);
    await nextDay();
    expect(await pickAll()).toEqual([twoB]);
  });

  it("doesn't let a page of one party's due bills, already called today, hide another party's", async () => {
    await drain();
    const many = await add('Party', { name: 'Many Bills Traders', partyType: 'retailer', phone: '+91 98470 13131' });
    const other = await add('Party', { name: 'Other Bill Traders', partyType: 'retailer', phone: '+91 98470 14141' });
    const bills = await db().tenant(a.tenantId, async (tx) => {
      const svc = h.get(RecordsService);
      const ws = await svc.activeWorkspace(tx);
      const ids: string[] = [];
      for (let n = 0; n < 102; n++) {
        const data = { billNo: `M-${n}`, billType: 'sales invoice', party: many, billDate: day(-10), dueDate: day(-3), total: 1000, paymentStatus: 'unpaid' };
        ids.push((await svc.create(tx, a.tenantId, ws, 'Bill', data, SYSTEM, { kind: 'agent' })).id);
      }
      return ids;
    });
    const last = await bill('M-other', { party: other });
    const picked = await pickAll();
    expect(picked).toHaveLength(2);
    expect(bills).toContain(picked[0]); // added in one transaction: same time, so any one of them
    expect(picked[1]).toBe(last);
    // Leave nothing due for the tests after this one.
    await db().tenant(a.tenantId, (tx) =>
      tx.insert(followUpAttempts).values(bills.filter((id) => id !== picked[0]).map((recordId) => ({ tenantId: a.tenantId, recordId, followUp: UNPAID, nextDueOn: day(30) }))),
    );
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
    await nextDay();
    await bill('H-1');
    await tenancy.updateSettings(a.session, { calls: { fastSchedule: false, partyHours: { days: [1, 2, 3, 4, 5, 6], start: '00:00', end: '00:01' } } });
    expect(await followUps.pick(a.tenantId)).toBeNull();
    await tenancy.updateSettings(a.session, { calls: { fastSchedule: true } });

    // Another number was called today, so the day's cap can be the calls made so far.
    await db().tenant(a.tenantId, (tx) =>
      tx.insert(calls).values({ tenantId: a.tenantId, stage: 'chase', attempt: 1, status: 'completed', provider: 'simulator', contactName: 'Cap Traders', contactPhone: '+91 98470 12121', followUp: UNPAID }),
    );
    const made = await db().tenant(a.tenantId, (tx) =>
      tx.select().from(calls).where(and(eq(calls.stage, 'chase'), sql`(${calls.createdAt} at time zone 'Asia/Kolkata')::date = ${istDate()}::date`)),
    );
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
    await nextDay();
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
    await drain();
    const id = await bill('R-1');
    const first = (await followUps.pick(a.tenantId))!;
    const [c] = await db().tenant(a.tenantId, (tx) => tx.update(calls).set({ status: 'completed' }).where(eq(calls.id, first.callId)).returning());
    expect(c!.recordId).toBe(id);
    const events = await db().tenant(a.tenantId, (tx) => tx.select().from(auditEvents).where(and(eq(auditEvents.type, 'call.scheduled'), eq(auditEvents.refId, first.callId))));
    expect(events[0]?.payload).toMatchObject({ staffName: 'Kaveri Spec Traders', stage: 'chase', followUp: UNPAID, title: expect.stringContaining('R-1') });
    await nextDay(); // only the item's own next due day holds it back, not the once-a-day rule
    expect(await followUps.pick(a.tenantId)).toBeNull();
  });

  it('never calls about sample items', async () => {
    const dueNow = async () => (await followUps.forList(a.session, 'bills')).find((f) => f.key === UNPAID)!.due;
    await drain();
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

describe('the call to an outside party', () => {
  const calling = () => h.get(FollowUpCallsService);
  const phone = () => h.get(CallsService);
  const lists = () => h.get(ListsService);

  /** Picks the item's call, rings it in the simulator and checks it is about that item. */
  async function ring(id: string): Promise<string> {
    const next = (await followUps.pick(a.tenantId))!;
    const [c] = await db().tenant(a.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, next.callId)));
    expect(c?.recordId).toBe(id);
    await calling().place(a.tenantId, next.callId);
    return next.callId;
  }
  const attempt = async (id: string) => (await db().tenant(a.tenantId, (tx) => tx.select().from(followUpAttempts).where(eq(followUpAttempts.recordId, id))))[0]!;
  beforeEach(drain);

  it('asks who it is speaking to, records a promise as a note, and calls again the day after it', async () => {
    const id = await bill('F-1');
    const callId = await ring(id);
    expect(await phone().get(a.tenantId, callId)).toMatchObject({
      stage: 'chase',
      status: 'ringing',
      staffName: 'Kaveri Spec Traders',
      staffTitle: 'Outside party',
      contact: { name: 'Kaveri Spec Traders', phone: '+91 98470 22222' },
      about: { listId: 'bills', itemId: id, title: 'F-1' },
      suggestions: ['Yes, speaking', 'Wrong number', 'Who is this?'],
    });
    await phone().answer(a.tenantId, callId);
    expect((await phone().get(a.tenantId, callId)).transcript[0]!.text).toMatch(/^Hello, this is an AI assistant calling from .+\. Am I speaking with someone from Kaveri Spec Traders\?$/);
    await phone().reply(a.tenantId, callId, 'Yes, speaking');
    await phone().reply(a.tenantId, callId, 'We will pay it tomorrow');
    await calling().finish(a.tenantId, callId);

    expect(await phone().get(a.tenantId, callId)).toMatchObject({ status: 'completed', outcome: 'promised' });
    const { item, notes } = await lists().item(a.tenantId, 'bills', id);
    expect(item.data.paymentStatus).toBe('unpaid');
    expect(notes[0]).toMatchObject({ kind: 'promise', speaker: 'Kaveri Spec Traders', said: 'We will pay it tomorrow', promiseOn: day(1), status: 'new', callId });
    expect(await attempt(id)).toMatchObject({ state: 'active', tries: 0, nextDueOn: day(2) });
    await nextDay(); // only the note and the promised day hold it back
    expect(await followUps.pick(a.tenantId)).toBeNull();

    await h.get(NotesService).dismiss(a.session, notes[0]!.id);
    await db().tenant(a.tenantId, (tx) => tx.update(followUpAttempts).set({ nextDueOn: day(0) }).where(eq(followUpAttempts.recordId, id)));
    const again = (await followUps.pick(a.tenantId))!;
    const [c] = await db().tenant(a.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, again.callId)));
    expect(c?.recordId).toBe(id);
    await done(again.callId);
  });

  it('proposes paid with its reference, waits for the head, and Apply sets it', async () => {
    const id = await bill('F-2');
    const callId = await ring(id);
    await phone().answer(a.tenantId, callId);
    for (const text of ['Yes', "It's already paid", 'UTR 445566']) await phone().reply(a.tenantId, callId, text);
    await calling().finish(a.tenantId, callId);
    const before = await lists().item(a.tenantId, 'bills', id);
    expect(before.item.data.paymentStatus).toBe('unpaid');
    expect(before.item.data.paymentRef).toBeUndefined();
    expect(before.item.updated?.via).not.toBe('call');
    expect(before.history.filter((e) => e.kind === 'updated')).toEqual([]);
    const { notes } = before;
    expect(notes[0]).toMatchObject({ kind: 'said', said: "It's already paid. UTR 445566" });
    expect(notes[0]!.proposed.map((p) => [p.field, p.value])).toEqual([['paymentStatus', 'paid'], ['paymentRef', '445566']]);
    expect(await attempt(id)).toMatchObject({ state: 'waiting_for_you' });
    await h.get(NotesService).apply(a.session, notes[0]!.id);
    const { item } = await lists().item(a.tenantId, 'bills', id);
    expect(item.data).toMatchObject({ paymentStatus: 'paid', paymentRef: '445566' });
    expect(item.checked?.by).toBe('Asha Owner');
  });

  it('puts a wrong number on the do-not-call list and never calls it again', async () => {
    const wrong = await add('Party', { name: 'Wrong Number Traders', partyType: 'retailer', phone: '+91 98470 44444' });
    const id = await bill('F-3', { party: wrong });
    const callId = await ring(id);
    await phone().answer(a.tenantId, callId);
    await phone().reply(a.tenantId, callId, 'Wrong number');
    await calling().finish(a.tenantId, callId);
    const [dnc] = await db().tenant(a.tenantId, (tx) => tx.select().from(doNotCall).where(eq(doNotCall.phone, '9847044444')));
    expect(dnc).toMatchObject({ reason: 'wrong_number', recordId: id, callId });
    expect((await lists().item(a.tenantId, 'bills', id)).notes[0]).toMatchObject({ kind: 'wrong_number' });
    expect(await attempt(id)).toMatchObject({ state: 'stopped' });
    await bill('F-4', { party: wrong });
    await nextDay(); // only the do-not-call list holds it back
    expect(await pickAll()).toEqual([]);
  });

  it('counts unanswered calls and stops after the third, with a note for the head', async () => {
    const id = await bill('F-5');
    for (let n = 1; n <= 3; n++) {
      if (n > 1) {
        await nextDay();
        await db().tenant(a.tenantId, (tx) => tx.update(followUpAttempts).set({ nextDueOn: day(0) }).where(eq(followUpAttempts.recordId, id)));
      }
      const callId = await ring(id);
      expect((await phone().get(a.tenantId, callId)).attempt).toBe(n);
      await phone().decline(a.tenantId, callId);
      await calling().finish(a.tenantId, callId);
      if (n < 3) expect(await attempt(id)).toMatchObject({ state: 'active', tries: n, nextDueOn: day(3) });
    }
    expect(await attempt(id)).toMatchObject({ state: 'stopped', tries: 3 });
    expect((await lists().item(a.tenantId, 'bills', id)).notes[0]).toMatchObject({
      kind: 'unreachable',
      said: "Couldn't reach Kaveri Spec Traders after 3 tries. Please follow up yourself.",
    });
  });

  it("doesn't count a call that could not be placed as a try", async () => {
    const id = await bill('F-7');
    const callId = await db().tenant(a.tenantId, async (tx) => {
      await tx.insert(followUpAttempts).values({ tenantId: a.tenantId, recordId: id, followUp: UNPAID, nextDueOn: day(1), tries: 1 });
      const [c] = await tx
        .insert(calls)
        .values({
          tenantId: a.tenantId,
          stage: 'chase',
          attempt: 2,
          status: 'failed',
          provider: 'twilio',
          recordId: id,
          followUp: UNPAID,
          contactName: 'Kaveri Spec Traders',
          contactPhone: '+91 98470 22222',
          outcome: 'no_answer',
          summary: "Couldn't place the call. Twilio said no.",
          extracted: { about: { listId: 'bills', itemId: id, title: 'F-7' } },
        })
        .returning();
      return c!.id;
    });
    await calling().finish(a.tenantId, callId);
    expect(await attempt(id)).toMatchObject({ state: 'active', tries: 1, nextDueOn: day(1) });
    expect((await lists().item(a.tenantId, 'bills', id)).notes).toEqual([]);
    expect(await phone().get(a.tenantId, callId)).toMatchObject({ status: 'failed', summary: "Couldn't place the call. Twilio said no." });
  });

  it("counts a call that never confirmed who it reached as a try, and stops after the third", async () => {
    const id = await bill('F-9');
    for (let n = 1; n <= 3; n++) {
      if (n > 1) {
        await nextDay();
        await db().tenant(a.tenantId, (tx) => tx.update(followUpAttempts).set({ nextDueOn: day(0) }).where(eq(followUpAttempts.recordId, id)));
      }
      const callId = await ring(id);
      await phone().answer(a.tenantId, callId);
      await phone().reply(a.tenantId, callId, 'No sir');
      await calling().finish(a.tenantId, callId);
      if (n < 3) expect(await attempt(id)).toMatchObject({ state: 'active', tries: n, nextDueOn: day(3) });
    }
    expect(await attempt(id)).toMatchObject({ state: 'stopped', tries: 3 });
    const { notes } = await lists().item(a.tenantId, 'bills', id);
    expect(notes.map((x) => x.kind)).toEqual(['unreachable']);
  });

  it('counts a call that dropped before the person said who they are as a try', async () => {
    const id = await bill('F-10');
    const callId = await ring(id);
    await phone().answer(a.tenantId, callId);
    await calling().endUnanswered(a.tenantId, callId);
    await calling().finish(a.tenantId, callId);
    expect(await phone().get(a.tenantId, callId)).toMatchObject({ status: 'completed', summary: 'The call dropped before an answer.' });
    expect(await attempt(id)).toMatchObject({ state: 'active', tries: 1, nextDueOn: day(3) });
  });

  it('plays the whole call in the simulator when nobody answers in the app', async () => {
    const tenancy = h.get(TenancyService);
    await tenancy.updateSettings(a.session, { calls: { simulatorMode: 'auto' } });
    try {
      const id = await bill('F-6');
      const next = (await followUps.pick(a.tenantId))!;
      expect(await calling().place(a.tenantId, next.callId)).toEqual({ done: true });
      await calling().finish(a.tenantId, next.callId);
      expect(await phone().get(a.tenantId, next.callId)).toMatchObject({ status: 'completed', outcome: 'promised' });
      expect((await lists().item(a.tenantId, 'bills', id)).notes[0]).toMatchObject({ kind: 'promise' });
    } finally {
      await tenancy.updateSettings(a.session, { calls: { simulatorMode: 'interactive' } });
    }
  });

  it('does not ring a planned call once the company is paused, the follow-up is off, or the number is blocked', async () => {
    const tenancy = h.get(TenancyService);
    await tenancy.updateSettings(a.session, { calls: { followUpsPerDay: 500 } });
    const party = await add('Party', { name: 'Gate Traders', partyType: 'retailer', phone: '+91 98470 66666' });
    const block = () => db().tenant(a.tenantId, (tx) => tx.insert(doNotCall).values({ tenantId: a.tenantId, phone: '9847066666', reason: 'asked' }));
    const unblock = () => db().tenant(a.tenantId, (tx) => tx.delete(doNotCall).where(eq(doNotCall.phone, '9847066666')));
    const cases: [string, () => Promise<unknown>, () => Promise<unknown>][] = [
      ['The company is paused.', () => tenancy.setTenantPaused(a.session, true), () => tenancy.setTenantPaused(a.session, false)],
      ['The follow-up was switched off.', () => followUps.switch(a.session, UNPAID, false), () => followUps.switch(a.session, UNPAID, true)],
      ['The number is on the do-not-call list.', block, unblock],
    ];
    for (const [n, [why, gate, ungate]] of cases.entries()) {
      await pickAll();
      const id = await bill(`G-${n}`, { party });
      const { callId } = (await followUps.pick(a.tenantId))!;
      await gate();
      expect(await calling().place(a.tenantId, callId)).toEqual({ done: true });
      const [c] = await db().tenant(a.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, callId)));
      expect(c).toMatchObject({ recordId: id, status: 'cancelled', summary: why });
      await calling().finish(a.tenantId, callId);
      expect(await attempt(id)).toMatchObject({ state: 'active', tries: 0 });
      await ungate();
    }
    const events = await db().tenant(a.tenantId, (tx) => tx.select().from(auditEvents).where(eq(auditEvents.type, 'call.cancelled')));
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it('treats a second place of a ringing call as still on, and finish ends a call left open', async () => {
    await pickAll();
    const id = await bill('L-1');
    const { callId } = (await followUps.pick(a.tenantId))!;
    expect(await calling().place(a.tenantId, callId)).toEqual({ done: false });
    expect(await calling().place(a.tenantId, callId)).toEqual({ done: false });
    await calling().finish(a.tenantId, callId);
    const [c] = await db().tenant(a.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, callId)));
    expect(c).toMatchObject({ status: 'no_answer' });
    expect(await attempt(id)).toMatchObject({ state: 'active', tries: 1 });
  });
});

describe('calling hours when calls are real', () => {
  const NEVER = { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:01' }; // never meets the legal 9:00–21:00
  type Calls = (typeof tenants.$inferSelect)['settings']['calls'];
  let saved: Calls;
  /** Writes the company's call settings straight to its row: updateSettings refuses real calls without Twilio set up on the server. */
  const setCalls = (patch: Partial<Calls>) =>
    db().tenant(a.tenantId, async (tx) => {
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, a.tenantId));
      await tx.update(tenants).set({ settings: { ...t!.settings, calls: { ...t!.settings.calls, ...patch } } }).where(eq(tenants.id, a.tenantId));
    });
  const callOf = async (callId: string) => (await db().tenant(a.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, callId))))[0]!;
  beforeAll(async () => {
    const [t] = await db().tenant(a.tenantId, (tx) => tx.select().from(tenants).where(eq(tenants.id, a.tenantId)));
    saved = t!.settings.calls;
  });
  beforeEach(drain);
  afterEach(() => setCalls(saved));

  it('picks nothing outside calling hours with real calls, even on the fast schedule', async () => {
    const id = await bill('T-1');
    await setCalls({ provider: 'twilio', fastSchedule: true, partyHours: NEVER });
    expect(await followUps.pick(a.tenantId)).toBeNull();
    await setCalls(saved);
    const next = (await followUps.pick(a.tenantId))!;
    expect((await callOf(next.callId)).recordId).toBe(id);
    await done(next.callId);
  });

  it('cancels a planned call when real calls are switched on outside calling hours', async () => {
    const id = await bill('T-2');
    const { callId } = (await followUps.pick(a.tenantId))!;
    await setCalls({ provider: 'twilio', fastSchedule: true, partyHours: NEVER });
    expect(await h.get(FollowUpCallsService).place(a.tenantId, callId)).toEqual({ done: true });
    expect(await callOf(callId)).toMatchObject({ recordId: id, status: 'cancelled', summary: 'It is outside calling hours.' });
  });

  it('keeps calling hours for a real call even after the company goes back to the fast simulator', async () => {
    const id = await bill('T-3');
    const { callId } = (await followUps.pick(a.tenantId))!;
    // Planned while real calls were on: the call rings through Twilio whatever the settings say now.
    await db().tenant(a.tenantId, (tx) => tx.update(calls).set({ provider: 'twilio' }).where(eq(calls.id, callId)));
    await setCalls({ provider: 'simulator', fastSchedule: true, partyHours: NEVER });
    await h.get(FollowUpCallsService).place(a.tenantId, callId);
    expect(await callOf(callId)).toMatchObject({ recordId: id, status: 'cancelled', summary: 'It is outside calling hours.' });
  });

  it('plans one call when two sweeps pick at once', async () => {
    const other = await add('Party', { name: 'Race Traders', partyType: 'retailer', phone: '+91 98470 17171' });
    await bill('T-4');
    await bill('T-5', { party: other });
    // Open connections first, so the two picks really run side by side instead of one waiting to connect.
    await Promise.all([1, 2, 3, 4].map(() => db().tenant(a.tenantId, (tx) => tx.execute(sql`select pg_sleep(0.05)`))));
    const [x, y] = await Promise.all([followUps.pick(a.tenantId), followUps.pick(a.tenantId)]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    await done((x ?? y)!.callId);
  });
});

describe('calling again after a follow-up stopped', () => {
  const notesOf = async (id: string) => db().tenant(a.tenantId, (tx) => tx.select().from(recordNotes).where(eq(recordNotes.recordId, id)));
  const attemptOf = async (id: string) => (await db().tenant(a.tenantId, (tx) => tx.select().from(followUpAttempts).where(eq(followUpAttempts.recordId, id))))[0]!;
  const pickedRecord = async () => {
    const next = await followUps.pick(a.tenantId);
    if (!next) return null;
    const [c] = await db().tenant(a.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, next.callId)));
    await done(next.callId);
    return c!.recordId;
  };
  /** A bill whose party has no phone: the sweep stops it with an "unreachable" note. */
  async function stoppedForNoPhone(name: string, billNo: string) {
    const party = await add('Party', { name, partyType: 'retailer' });
    const id = await bill(billNo, { party });
    expect(await pickAll()).toEqual([]);
    const [note] = await notesOf(id);
    expect(note).toMatchObject({ kind: 'unreachable', status: 'new' });
    return { party, id, note: note! };
  }
  beforeEach(drain);

  it('starts a follow-up stopped for want of a phone number again, once the number is added', async () => {
    const { party, id, note } = await stoppedForNoPhone('Later Phone Traders', 'CA-1');
    await db().tenant(a.tenantId, async (tx) => {
      const svc = h.get(RecordsService);
      await svc.update(tx, a.tenantId, await svc.activeWorkspace(tx), 'Party', party, { phone: '+91 98470 15151' }, { actor: { id: a.session.principalId, kind: 'human' }, via: 'manual' });
    });
    await h.get(NotesService).callAgain(a.session, note.id);
    expect((await notesOf(id))[0]).toMatchObject({ status: 'dismissed', decidedBy: a.session.principalId });
    expect(await attemptOf(id)).toMatchObject({ state: 'active', tries: 0, nextDueOn: day(0) });
    const [event] = await db().tenant(a.tenantId, (tx) => tx.select().from(auditEvents).where(and(eq(auditEvents.type, 'followup.restarted'), eq(auditEvents.refId, id))));
    expect(event?.payload).toEqual({ title: 'CA-1', unblocked: false });
    expect(await pickedRecord()).toBe(id);
  });

  it('lifts the wrong-number block and calls the number again', async () => {
    const party = await add('Party', { name: 'Wrong Again Traders', partyType: 'retailer', phone: '+91 98470 16161' });
    const id = await bill('CA-2', { party });
    const { callId } = (await followUps.pick(a.tenantId))!;
    await h.get(FollowUpCallsService).place(a.tenantId, callId);
    await h.get(CallsService).answer(a.tenantId, callId);
    await h.get(CallsService).reply(a.tenantId, callId, 'Wrong number');
    await h.get(FollowUpCallsService).finish(a.tenantId, callId);
    const blockedRows = () => db().tenant(a.tenantId, (tx) => tx.select().from(doNotCall).where(eq(doNotCall.phone, '9847016161')));
    expect(await blockedRows()).toHaveLength(1);
    const [note] = await notesOf(id);
    expect(note).toMatchObject({ kind: 'wrong_number', status: 'new' });

    await h.get(NotesService).callAgain(a.session, note!.id);
    expect(await blockedRows()).toEqual([]);
    const [event] = await db().tenant(a.tenantId, (tx) => tx.select().from(auditEvents).where(and(eq(auditEvents.type, 'followup.restarted'), eq(auditEvents.refId, id))));
    expect(event?.payload).toEqual({ title: 'CA-2', unblocked: true });
    await nextDay(); // the number was called today
    expect(await pickedRecord()).toBe(id);
  });

  it('lets only the owner start calls to an outside party again', async () => {
    const { id, note } = await stoppedForNoPhone('Refused Traders', 'CA-3');
    await expect(h.get(NotesService).callAgain(admin, note.id)).rejects.toThrow(/Only the owner/);
    await expect(h.get(NotesService).callAgain({ ...a.session, role: 'member' }, note.id)).rejects.toThrow(/Only the owner/);
    expect(await attemptOf(id)).toMatchObject({ state: 'stopped' });
    expect((await notesOf(id))[0]).toMatchObject({ status: 'new' });
  });

  it('refuses a note that is not about a stopped follow-up', async () => {
    const id = await bill('CA-4');
    const noteId = await db().tenant(a.tenantId, (tx) =>
      h.get(NotesService).create(tx, a.tenantId, { recordId: id, callId: null, followUp: UNPAID, kind: 'promise', speaker: 'Kaveri Spec Traders', said: 'Friday', promiseOn: day(2) }),
    );
    await expect(h.get(NotesService).callAgain(a.session, noteId)).rejects.toThrow(/only .*stopped/i);
    await h.get(NotesService).dismiss(a.session, noteId);
  });
});

describe('calls about list items are for the owner and admins', () => {
  beforeEach(drain);

  it("keeps a member out of a call to a party: it isn't listed or found, and they can't answer it", async () => {
    const member: Session = { ...a.session, role: 'member' };
    const phone = h.get(CallsService);
    await bill('M-8');
    const { callId } = (await followUps.pick(a.tenantId))!;
    expect((await phone.listFor(member)).map((c) => c.id)).not.toContain(callId);
    await expect(phone.getFor(member, callId)).rejects.toThrow('Call not found');
    expect((await phone.listFor(a.session)).map((c) => c.id)).toContain(callId);
    expect((await phone.getFor(admin, callId)).id).toBe(callId);

    await h.get(FollowUpCallsService).place(a.tenantId, callId);
    expect((await phone.activeFor(member)).map((c) => c.id)).not.toContain(callId);
    expect((await phone.activeFor(a.session)).map((c) => c.id)).toContain(callId);
    await expect(phone.answerFor(member, callId)).rejects.toThrow('Call not found');
    await expect(phone.replyFor(member, callId, 'Yes, speaking')).rejects.toThrow('Call not found');
    await expect(phone.declineFor(member, callId)).rejects.toThrow('Call not found');
    expect((await phone.get(a.tenantId, callId)).status).toBe('ringing');

    expect((await phone.answerFor(a.session, callId)).status).toBe('in_progress');
    await phone.declineFor(a.session, callId);
    await h.get(FollowUpCallsService).finish(a.tenantId, callId);
  });
});

describe('follow-ups to the team', () => {
  let it2: Org;
  let anilId: string;
  const OVERDUE = 'tickets.overdue-tickets';
  const ticket = (summary: string, assignedTo: string) =>
    db().tenant(it2.tenantId, async (tx) => {
      const svc = h.get(RecordsService);
      const data = { ticketNo: `T-${summary.length}`, clientName: 'Acme', summary, assignedTo, status: 'assigned', dueBy: new Date(Date.now() - 86_400_000).toISOString() };
      return (await svc.create(tx, it2.tenantId, await svc.activeWorkspace(tx), 'Ticket', data, SYSTEM, { kind: 'agent' })).id;
    });

  beforeAll(async () => {
    it2 = await newOrg(h, 'it-services');
    await h.get(ListsService).removeSamples(it2.session);
    anilId = (await h.get(TeamService).create(it2.session, CreateStaffInputSchema.parse({ name: 'Anil Kumar', phone: '+91 98470 55555', title: 'Engineer' }))).id;
    await followUps.switch({ ...it2.session, role: 'admin' }, OVERDUE, true);
  });

  it("updates the item from the engineer's answer at once, and it needs checking again", async () => {
    const id = await ticket('Printer not working', 'Anil');
    await h.get(ListsService).check(it2.session, 'tickets', id, { note: 'Known' });
    const next = (await followUps.pick(it2.tenantId))!;
    const callsSvc = h.get(CallsService);
    expect(await callsSvc.get(it2.tenantId, next.callId)).toMatchObject({ staffId: anilId, staffName: 'Anil Kumar', contact: null });
    await h.get(FollowUpCallsService).place(it2.tenantId, next.callId);
    await callsSvc.answer(it2.tenantId, next.callId);
    expect((await callsSvc.get(it2.tenantId, next.callId)).transcript[0]!.text).toMatch(/^Hi Anil, this is the AI assistant at .+, about ticket .+\. What's the status\?$/);
    await callsSvc.reply(it2.tenantId, next.callId, "It's in progress, done by tomorrow 5 pm");
    await h.get(FollowUpCallsService).finish(it2.tenantId, next.callId);

    const { item, history } = await h.get(ListsService).item(it2.tenantId, 'tickets', id);
    expect(item.data.status).toBe('in-progress');
    expect(item.data.dueBy).toBe(new Date(`${day(1)}T17:00:00+05:30`).toISOString());
    expect(item.checked).toBeNull();
    expect(item.updated).toMatchObject({ via: 'call', by: 'Anil Kumar' });
    expect(history.at(-1)).toMatchObject({ kind: 'updated', note: `On the call: "It's in progress, done by tomorrow 5 pm"` });
    expect(await callsSvc.get(it2.tenantId, next.callId)).toMatchObject({ outcome: 'updated' });
  });

  it('calls a team member at most once a day, about one item', async () => {
    await nextDay(it2.tenantId);
    const first = await ticket('Router keeps dropping', 'Anil');
    const second = await ticket('Laptop battery swollen badly', 'Anil');
    const picked = (await followUps.pick(it2.tenantId))!;
    const [c] = await db().tenant(it2.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, picked.callId)));
    expect(c?.recordId).toBe(first);
    await done(picked.callId, it2.tenantId);
    expect(await followUps.pick(it2.tenantId)).toBeNull();
    await nextDay(it2.tenantId);
    const next = (await followUps.pick(it2.tenantId))!;
    const [d] = await db().tenant(it2.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, next.callId)));
    expect(d?.recordId).toBe(second);
    await done(next.callId, it2.tenantId);
  });

  it('leaves a note when nobody in the team has the name on the item', async () => {
    const id = await ticket('Scanner jammed', 'Nobody Here');
    expect(await followUps.pick(it2.tenantId)).toBeNull();
    const { notes } = await h.get(ListsService).item(it2.tenantId, 'tickets', id);
    expect(notes[0]).toMatchObject({ kind: 'unreachable', speaker: 'ONEHUMAN OS' });
    expect(notes[0]!.said).toMatch(/^Couldn't find Nobody Here in your team/);
  });
});
