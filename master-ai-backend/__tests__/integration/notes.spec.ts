import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateStaffInputSchema } from '@onehuman/schemas';
import { SYSTEM } from '../../src/audit/audit.service';
import { DbService } from '../../src/db/db.service';
import { auditEvents, calls, followUpAttempts, recordNotes, records } from '../../src/db/schema';
import { ListsService } from '../../src/lists/lists.service';
import { NotesService, type NewNote } from '../../src/notes/notes.service';
import { RecordsService } from '../../src/records/records.service';
import { TeamService } from '../../src/voice/team.service';
import { istDate } from '../../src/voice/time';
import { boot, newOrg, type Harness, type Org } from './harness';

let h: Harness;
let a: Org;
let b: Org;
let lists: ListsService;
let notes: NotesService;
let partyId: string;
const today = istDate();
const tomorrow = istDate(new Date(Date.now() + 86_400_000));

beforeAll(async () => {
  h = await boot();
  [a, b] = await Promise.all([newOrg(h, 'wholesale-retail'), newOrg(h, 'wholesale-retail')]);
  lists = h.get(ListsService);
  notes = h.get(NotesService);
  partyId = (await lists.page(a.tenantId, 'parties', { range: 'all' })).items[0]!.id;
});
afterAll(() => h.close());

async function bill(billNo: string, extra: Record<string, unknown> = {}): Promise<string> {
  return h.get(DbService).tenant(a.tenantId, async (tx) => {
    const svc = h.get(RecordsService);
    const ws = await svc.activeWorkspace(tx);
    const data = { billNo, billType: 'sales invoice', party: partyId, billDate: today, total: 100, paymentStatus: 'unpaid', ...extra };
    return (await svc.create(tx, a.tenantId, ws, 'Bill', data, SYSTEM, { kind: 'agent' })).id;
  });
}
const paidNote = (recordId: string, over: Partial<NewNote> = {}): NewNote => ({
  recordId,
  callId: null,
  followUp: 'bills.unpaid-bills',
  kind: 'said',
  speaker: 'Sri Ganesh Traders',
  said: "It's paid, UTR 4455",
  proposed: { paymentStatus: 'paid', paymentRef: 'UTR4455' },
  ...over,
});
const addNote = (n: NewNote) => h.get(DbService).tenant(a.tenantId, (tx) => notes.create(tx, a.tenantId, n));

describe('notes from calls on the lists', () => {
  it('shows a new note on the item, on its card and under New from calls', async () => {
    const id = await bill('N-1');
    await addNote(paidNote(id));
    const page = await lists.page(a.tenantId, 'bills', { range: 'all', show: 'new_notes' });
    expect(page.items.map((i) => i.id)).toContain(id);
    expect(page.items.find((i) => i.id === id)!.newNotes).toBe(1);
    const card = (await lists.overview(a.tenantId)).lists.find((l) => l.id === 'bills')!.card;
    expect(card.newNotes).toBeGreaterThanOrEqual(1);
    const { notes: shown } = await lists.item(a.tenantId, 'bills', id);
    expect(shown[0]).toMatchObject({ kind: 'said', speaker: 'Sri Ganesh Traders', said: "It's paid, UTR 4455", status: 'new', decidedBy: null });
    expect(shown[0]!.proposed).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'paymentStatus', value: 'paid' }), expect.objectContaining({ field: 'paymentRef', value: 'UTR4455' })]));
  });

  it('applies a note: sets its fields, checks the item, and keeps what was said in the history', async () => {
    const id = await bill('N-2');
    const noteId = await addNote(paidNote(id));
    await notes.apply(a.session, noteId);
    const { item, history, notes: shown } = await lists.item(a.tenantId, 'bills', id);
    expect(item.data).toMatchObject({ paymentStatus: 'paid', paymentRef: 'UTR4455' });
    expect(item.checked?.by).toBe('Asha Owner');
    expect(item.newNotes).toBe(0);
    expect(shown[0]).toMatchObject({ status: 'applied', decidedBy: 'Asha Owner' });
    expect(history.at(-1)).toMatchObject({ kind: 'updated', note: 'From the call: "It\'s paid, UTR 4455"' });
    const events = await h.get(DbService).tenant(a.tenantId, (tx) => tx.select().from(auditEvents).where(and(eq(auditEvents.refId, id), eq(auditEvents.type, 'note.applied'))));
    expect(events).toHaveLength(1);
    await expect(notes.apply(a.session, noteId)).rejects.toThrow(/already/i);
  });

  it('only lets a note with nothing to apply be marked as seen', async () => {
    const id = await bill('N-3');
    const noteId = await addNote(paidNote(id, { kind: 'promise', said: 'We will pay on Friday', proposed: {}, promiseOn: tomorrow }));
    await expect(notes.apply(a.session, noteId)).rejects.toThrow(/nothing to apply/i);
    await notes.dismiss(a.session, noteId);
    const { item, notes: shown } = await lists.item(a.tenantId, 'bills', id);
    expect(shown[0]).toMatchObject({ kind: 'promise', promiseOn: tomorrow, status: 'dismissed' });
    expect(item.newNotes).toBe(0);
  });

  it('starts calling again tomorrow about an item that waited for the head', async () => {
    const id = await bill('N-4');
    await h.get(DbService).tenant(a.tenantId, (tx) =>
      tx.insert(followUpAttempts).values({ tenantId: a.tenantId, recordId: id, followUp: 'bills.unpaid-bills', nextDueOn: today, state: 'waiting_for_you' }),
    );
    const noteId = await addNote(paidNote(id, { kind: 'dispute', said: 'The goods never came', proposed: {} }));
    await notes.dismiss(a.session, noteId);
    const [attempt] = await h.get(DbService).tenant(a.tenantId, (tx) => tx.select().from(followUpAttempts).where(eq(followUpAttempts.recordId, id)));
    expect(attempt).toMatchObject({ state: 'active', nextDueOn: tomorrow });
  });

  it("never finds another company's note", async () => {
    const id = await bill('N-5');
    const noteId = await addNote(paidNote(id));
    await expect(notes.apply(b.session, noteId)).rejects.toThrow(/not found/i);
    const [still] = await h.get(DbService).tenant(a.tenantId, (tx) => tx.select().from(recordNotes).where(eq(recordNotes.id, noteId)));
    expect(still?.status).toBe('new');
  });
});

describe('items from calls', () => {
  it('says which call an item came from, and who an item was changed with on a call', async () => {
    const ravi = await h.get(TeamService).create(a.session, CreateStaffInputSchema.parse({ name: 'Ravi Kumar', phone: '+91 98470 00001', title: 'Billing clerk' }));
    const [call] = await h.get(DbService).tenant(a.tenantId, (tx) =>
      tx.insert(calls).values({ tenantId: a.tenantId, staffId: ravi.id, stage: 'collect', attempt: 1, status: 'completed', provider: 'simulator' }).returning(),
    );
    const id = await h.get(DbService).tenant(a.tenantId, async (tx) => {
      const svc = h.get(RecordsService);
      const ws = await svc.activeWorkspace(tx);
      const row = await svc.create(tx, a.tenantId, ws, 'Bill', { billNo: 'C-1', billType: 'sales invoice' }, SYSTEM, { kind: 'call', ref: call!.id });
      await svc.update(tx, a.tenantId, ws, 'Bill', row.id, { total: 500 }, { actor: SYSTEM, via: 'call', ref: call!.id });
      return row.id;
    });
    const { item } = await lists.item(a.tenantId, 'bills', id);
    expect(item.source).toMatchObject({ kind: 'call', label: 'Call with Ravi Kumar', callId: call!.id });
    expect(item.updated).toMatchObject({ via: 'call', by: 'Ravi Kumar' });
    const [row] = await h.get(DbService).tenant(a.tenantId, (tx) => tx.select().from(records).where(eq(records.id, id)));
    expect(row?.updatedRef).toBe(call!.id);
  });
});
