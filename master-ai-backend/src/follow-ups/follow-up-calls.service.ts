import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { CallOutcome, ResolvedPack, TranscriptLine } from '@onehuman/schemas';
import { normalizeSnapshot, registersOf, titleOf, type ResolvedFollowUp, type ResolvedRegister } from '@onehuman/agent-kit';
import { AuditService, SYSTEM } from '../audit/audit.service';
import { DEFAULT_TENANT_SETTINGS } from '../common/mappers';
import { DbService, type Tx } from '../db/db.service';
import { calls, doNotCall, followUpAttempts, recordNotes, records, staff, tenants } from '../db/schema';
import { isUuid } from '../lists/format';
import { NotesService } from '../notes/notes.service';
import { TemporalService } from '../orchestration/temporal.service';
import { RecordsService } from '../records/records.service';
import { FollowUpEngine, followUpSuggestions, newFollowUpState, simulatedFollowUpReply, type FollowUpContext, type FollowUpResult, type FollowUpState } from '../voice/follow-up-engine';
import { aboutText, lowerFirst, sayDay } from '../voice/spoken';
import { addDaysTo, istDate } from '../voice/time';
import { TwilioService } from '../voice/twilio';
import { FollowUpsService } from './follow-ups.service';
import { phoneKey } from './targets';

type CallRow = typeof calls.$inferSelect;
type Loaded = { reg: ResolvedRegister; f: ResolvedFollowUp; rec: typeof records.$inferSelect; ctx: FollowUpContext; phone: string | null; pack: ResolvedPack; workspaceId: string };

const RING_SECONDS = 40;
const line = (speaker: TranscriptLine['speaker'], text: string): TranscriptLine => ({ speaker, text, at: new Date().toISOString() });

/**
 * One follow-up call about one list item, from ringing to what it leaves.
 * What an outside party says becomes a note (or a do-not-call entry); only a
 * team member's status answer changes the item, through RecordsService.update.
 * `finish` then sets when the item is due again, or that it waits for the
 * head, or that the follow-up has stopped for it.
 */
@Injectable()
export class FollowUpCallsService {
  private readonly logger = new Logger(FollowUpCallsService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly records: RecordsService,
    private readonly notes: NotesService,
    private readonly engine: FollowUpEngine,
    private readonly temporal: TemporalService,
    private readonly twilio: TwilioService,
    private readonly followUps: FollowUpsService,
  ) {}

  async plan(tenantId: string) {
    const s = await this.settings(tenantId);
    return { ringTimeoutMs: s.provider !== 'simulator' ? 90_000 : 45_000, talkTimeoutMs: 15 * 60_000 };
  }

  /**
   * Rings: a real call through Twilio, a simulated one in the app, or — in the simulator's auto mode — the whole call now.
   * `failed` when Twilio could not place it: the sweep stops there, as the next call would most likely fail the same way.
   */
  async place(tenantId: string, callId: string): Promise<{ done: boolean; failed?: boolean }> {
    const s = await this.settings(tenantId);
    const ready = await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, callId)).for('update');
      if (!c) return 'over' as const;
      // A retried activity: the call is already on, so the workflow waits for it to end.
      if (c.status === 'ringing' || c.status === 'in_progress') return 'live' as const;
      if (c.status !== 'scheduled') return 'over' as const;
      const loaded = await this.load(tx, c);
      const why = loaded ? await this.followUps.blocker(tx, c) : 'The item or its follow-up is gone.';
      if (why) {
        await tx.update(calls).set({ status: 'cancelled', endedAt: new Date(), summary: why }).where(eq(calls.id, callId));
        await this.audit.append(tx, tenantId, { type: 'call.cancelled', actor: SYSTEM, refId: callId, payload: { staffName: loaded?.ctx.name ?? c.contactName ?? 'someone', stage: 'chase', reason: why } });
        return 'over' as const;
      }
      await tx.update(calls).set({ status: 'ringing', extracted: { ...c.extracted, followUp: loaded!.ctx.state } }).where(eq(calls.id, callId));
      await this.audit.append(tx, tenantId, {
        type: 'call.ringing',
        actor: SYSTEM,
        refId: callId,
        payload: { staffName: loaded!.ctx.name, stage: 'chase', attempt: c.attempt, about: c.extracted.about?.title },
      });
      return { loaded: loaded!, provider: c.provider };
    });
    if (ready === 'live') return { done: false };
    if (ready === 'over') return { done: true };

    if (ready.provider === 'twilio') {
      try {
        const sid = await this.twilio.placeCall({ to: ready.loaded.phone ?? '', tenantId, callId, ringSeconds: RING_SECONDS });
        await this.db.tenant(tenantId, (tx) => tx.update(calls).set({ providerCallId: sid }).where(eq(calls.id, callId)));
      } catch (err) {
        this.logger.warn(`Follow-up call ${callId} not placed: ${(err as Error).message}`);
        await this.endUnanswered(tenantId, callId, `Couldn't place the call. ${(err as Error).message}`);
        return { done: true, failed: true };
      }
      return { done: false };
    }
    if (s.simulatorMode === 'interactive') return { done: false };

    // Auto mode: a simulated party or team member answers.
    const ctx = ready.loaded.ctx;
    let transcript: TranscriptLine[] = [line('ai', this.engine.opening(ctx))];
    let state = ctx.state;
    let callBack = false;
    await this.db.tenant(tenantId, (tx) => tx.update(calls).set({ status: 'in_progress', startedAt: new Date(), transcript }).where(eq(calls.id, callId)));
    for (let i = 0; i < 10 && state.phase !== 'done'; i++) {
      const reply = simulatedFollowUpReply({ ...ctx, state, transcript });
      const res = await this.engine.turn({ ...ctx, state, transcript }, reply);
      transcript = [...transcript, line('person', reply), line('ai', res.say)];
      state = res.state;
      callBack = res.callBack;
      if (res.end) break;
    }
    await this.conclude(tenantId, callId, transcript, state, callBack);
    return { done: true };
  }

  async answer(tenantId: string, call: CallRow) {
    await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, call.id)).for('update');
      if (!c || c.status !== 'ringing') throw new ConflictException(`Call is ${c?.status.replace('_', ' ') ?? 'gone'}`);
      const loaded = await this.load(tx, c);
      if (!loaded) throw new ConflictException('The item this call was about is gone');
      await tx.update(calls).set({ status: 'in_progress', startedAt: new Date(), transcript: [line('ai', this.engine.opening(loaded.ctx))] }).where(eq(calls.id, c.id));
    });
    await this.temporal.signalFollowUp(call.id, { callId: call.id, event: 'answered' });
  }

  async reply(tenantId: string, call: CallRow, text: string) {
    const { c, ctx } = await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, call.id));
      if (!c || c.status !== 'in_progress') throw new BadRequestException('Answer the call first');
      const loaded = await this.load(tx, c);
      if (!loaded) throw new ConflictException('The item this call was about is gone');
      return { c, ctx: loaded.ctx };
    });
    const res = await this.engine.turn(ctx, text);
    const transcript = [...c.transcript, line('person', text), line('ai', res.say)];
    if (res.end) {
      await this.conclude(tenantId, call.id, transcript, res.state, res.callBack);
      await this.temporal.signalFollowUp(call.id, { callId: call.id, event: 'ended' });
    } else {
      await this.db.tenant(tenantId, async (tx) => {
        const [now] = await tx.select().from(calls).where(eq(calls.id, call.id)).for('update');
        if (now?.status !== 'in_progress') return;
        await tx.update(calls).set({ transcript, extracted: { ...now.extracted, followUp: res.state } }).where(eq(calls.id, call.id));
      });
    }
  }

  async decline(tenantId: string, call: CallRow) {
    await this.endUnanswered(tenantId, call.id);
    await this.temporal.signalFollowUp(call.id, { callId: call.id, event: 'ended' });
  }

  /** Nobody answered, the call could not be placed, or it dropped mid-way (what was said so far still counts). */
  async endUnanswered(tenantId: string, callId: string, failure?: string) {
    const open = await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, callId)).for('update');
      if (!c) return null;
      if (c.status !== 'ringing' && c.status !== 'scheduled') return c;
      const name = await this.nameOf(tx, c);
      await tx
        .update(calls)
        .set({ status: failure ? 'failed' : 'no_answer', endedAt: new Date(), outcome: 'no_answer', summary: failure ?? `${name} didn't answer.` })
        .where(eq(calls.id, callId));
      await this.audit.append(tx, tenantId, { type: 'call.no_answer', actor: SYSTEM, refId: callId, payload: { staffName: name, stage: 'chase', attempt: c.attempt } });
      return null;
    });
    if (open?.status === 'in_progress') {
      await this.conclude(tenantId, callId, open.transcript, open.extracted.followUp ?? newFollowUpState('party'), false, true);
    }
  }

  /** After the call: when the item is due again, or that it waits for the head, or that the follow-up stopped. Safe to run twice. */
  async finish(tenantId: string, callId: string) {
    const [open] = await this.db.tenant(tenantId, (tx) => tx.select({ status: calls.status }).from(calls).where(eq(calls.id, callId)));
    if (open && (open.status === 'scheduled' || open.status === 'ringing' || open.status === 'in_progress')) await this.endUnanswered(tenantId, callId);
    await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, callId)).for('update');
      if (!c?.recordId || !c.followUp || c.extracted.attemptDone) return;
      await tx.update(calls).set({ extracted: { ...c.extracted, attemptDone: true } }).where(eq(calls.id, callId));
      const loaded = await this.load(tx, c);
      const [a] = await tx.select().from(followUpAttempts).where(and(eq(followUpAttempts.recordId, c.recordId), eq(followUpAttempts.followUp, c.followUp)));
      if (!loaded || !a) return;
      const { f } = loaded;
      const today = istDate();
      const result = c.extracted.followUp?.result ?? null;
      let set: Partial<typeof followUpAttempts.$inferInsert>;
      // Never rung (cancelled), or Twilio couldn't place it (failed): no try, and the item stays due tomorrow as set when it was picked.
      if (c.status === 'cancelled' || c.status === 'failed') return;
      // Ended before the person said who they are ("no", "call later", "who is this?" three times, or the line dropped), with nothing to note:
      // a try, like an unanswered call, so a wrong number that only says "no" is not rung for ever.
      const st = c.extracted.followUp;
      const unconfirmed = c.status === 'completed' && !!st && !st.result && (st.unconfirmed === true || st.phase === 'identity');
      if (c.status === 'no_answer' || unconfirmed) {
        const tries = a.tries + 1;
        if (tries >= f.maxTries) {
          set = { tries, state: 'stopped' };
          await this.notes.create(tx, tenantId, {
            recordId: c.recordId,
            callId,
            followUp: f.key,
            kind: 'unreachable',
            speaker: 'ONEHUMAN OS',
            said: `Couldn't reach ${loaded.ctx.name} after ${tries} tries. Please follow up yourself.`,
          });
        } else {
          set = { tries, nextDueOn: addDaysTo(today, f.everyDays) };
        }
      } else if (!result) {
        set = { tries: 0, nextDueOn: addDaysTo(today, c.outcome === 'call_back' ? 1 : f.everyDays) };
      } else {
        switch (result.kind) {
          case 'promise':
            set = { tries: 0, nextDueOn: addDaysTo(result.promiseOn, 1) };
            break;
          case 'settled':
          case 'dispute': {
            // Waits for the head only while the note is still there: one dismissed before the call finished leaves nothing to wait for.
            const [waiting] = await tx.select({ id: recordNotes.id }).from(recordNotes).where(and(eq(recordNotes.recordId, c.recordId), eq(recordNotes.followUp, f.key), eq(recordNotes.status, 'new'))).limit(1);
            set = waiting ? { tries: 0, state: 'waiting_for_you' } : { tries: 0, state: 'active', nextDueOn: addDaysTo(today, 1) };
            break;
          }
          case 'wrong_number':
            set = { tries: 0, state: 'stopped' };
            break;
          case 'do_not_call':
            set = f.who === 'party' ? { tries: 0, state: 'stopped' } : { tries: 0, nextDueOn: addDaysTo(today, f.everyDays) };
            break;
          default:
            set = { tries: 0, nextDueOn: addDaysTo(today, f.everyDays) };
        }
      }
      await tx.update(followUpAttempts).set({ ...set, lastCallAt: c.endedAt ?? new Date() }).where(eq(followUpAttempts.id, a.id));
    });
  }

  /** Likely replies for the simulator while a follow-up call is on. */
  async suggestionsFor(tx: Tx, c: CallRow): Promise<string[]> {
    if (c.status !== 'ringing' && c.status !== 'in_progress') return [];
    const loaded = await this.load(tx, c);
    return loaded ? followUpSuggestions(loaded.ctx) : [];
  }

  /** The call's words are in: write the call, and what it leaves on the item. */
  private async conclude(tenantId: string, callId: string, transcript: TranscriptLine[], state: FollowUpState, callBack: boolean, dropped = false) {
    await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, callId)).for('update');
      if (!c || c.status === 'completed') return;
      const loaded = await this.load(tx, c);
      const name = loaded?.ctx.name ?? c.contactName ?? 'They';
      const result = state.result;
      let { outcome, summary }: { outcome: CallOutcome; summary: string } = result && loaded ? outcomeOf(result, name, loaded) : callBack ? { outcome: 'call_back' as const, summary: `${name} asked to be called another time.` } : { outcome: 'unclear' as const, summary: dropped ? 'The call dropped before an answer.' : 'No answer about the item.' };
      // What the call leaves comes first: a refused update to the item is a note, and the call log says so.
      if (result && loaded && c.recordId && (await this.leave(tx, tenantId, c, loaded, result)) === 'refused') {
        outcome = 'noted';
        summary = `Noted what ${name.split(' ')[0]} said; it didn't fit the item, so it's left for you.`;
      }
      await tx.update(calls).set({ status: 'completed', endedAt: new Date(), transcript, outcome, summary, extracted: { ...c.extracted, followUp: state } }).where(eq(calls.id, callId));
      await this.audit.append(tx, tenantId, { type: 'call.completed', actor: SYSTEM, refId: callId, payload: { staffName: name, stage: 'chase', outcome, summary } });
    });
  }

  /** What a result leaves on the item: a note, a do-not-call entry, or (a team member's answer) the change itself. */
  private async leave(tx: Tx, tenantId: string, c: CallRow, loaded: Loaded, result: FollowUpResult): Promise<'refused' | void> {
    const recordId = c.recordId!;
    const note = (kind: 'said' | 'promise' | 'dispute' | 'wrong_number', extra: { proposed?: Record<string, unknown>; promiseOn?: string } = {}) =>
      this.notes.create(tx, tenantId, { recordId, callId: c.id, followUp: loaded.f.key, kind, speaker: loaded.ctx.name, said: result.said, ...extra });
    const block = async (reason: 'asked' | 'wrong_number') => {
      const phone = loaded.phone ? phoneKey(loaded.phone) : '';
      if (phone.length < 10) return;
      await tx.insert(doNotCall).values({ tenantId, phone, reason, recordId, callId: c.id }).onConflictDoNothing();
      await this.audit.append(tx, tenantId, { type: 'do_not_call.added', actor: SYSTEM, refId: recordId, payload: { name: loaded.ctx.name, reason } });
    };
    switch (result.kind) {
      case 'settled':
        return void (await note('said', { proposed: result.proposed }));
      case 'promise':
        return void (await note('promise', { promiseOn: result.promiseOn }));
      case 'dispute':
        return void (await note('dispute'));
      case 'wrong_number':
        await note('wrong_number');
        return block('wrong_number');
      case 'do_not_call':
        if (loaded.f.who === 'party') return block('asked');
        return void (await note('said'));
      case 'status':
        if (loaded.f.who !== 'staff') return void (await note('said'));
        try {
          await this.records.update(tx, tenantId, { id: loaded.workspaceId, pack: loaded.pack }, loaded.reg.entity.name, recordId, result.patch, {
            actor: SYSTEM,
            via: 'call',
            ref: c.id,
            note: `On the call: "${result.said}"`,
          });
        } catch (err) {
          if (!(err instanceof BadRequestException)) throw err;
          await note('said');
          return 'refused';
        }
        return;
      case 'said':
        return void (await note('said'));
    }
  }

  /** Everything a follow-up call needs, from its row: the list, the follow-up, the item, and the call's context. Null when any is gone. */
  private async load(tx: Tx, c: CallRow): Promise<Loaded | null> {
    if (!c.recordId || !c.followUp) return null;
    const ws = await this.records.activeWorkspace(tx);
    const pack = normalizeSnapshot(ws.pack);
    const reg = registersOf(pack).find((r) => r.followUps.some((f) => f.key === c.followUp));
    const f = reg?.followUps.find((x) => x.key === c.followUp);
    const [rec] = await tx.select().from(records).where(eq(records.id, c.recordId));
    if (!reg || !f || !rec) return null;
    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, c.tenantId));
    const [person] = c.staffId ? await tx.select().from(staff).where(eq(staff.id, c.staffId)) : [];
    const titles: Record<string, string> = {};
    for (const field of f.about.filter((x) => x.type === 'reference')) {
      const id = rec.data[field.name];
      const target = pack.entities.find((e) => e.name === field.ref);
      if (!isUuid(id) || !target) continue;
      const [ref] = await tx.select({ data: records.data }).from(records).where(eq(records.id, id));
      if (ref) titles[field.name] = titleOf(target, ref.data);
    }
    const now = new Date();
    const ctx: FollowUpContext = {
      tenantId: c.tenantId,
      companyName: tenant?.name ?? 'the company',
      who: f.who,
      name: person?.name ?? c.contactName ?? 'there',
      about: aboutText(lowerFirst(reg.entity.label), f.about, rec.data, titles, now),
      findOut: f.findOut,
      state: c.extracted.followUp ?? newFollowUpState(f.who),
      transcript: c.transcript,
      now,
    };
    return { reg, f, rec, ctx, phone: person?.phone ?? c.contactPhone, pack, workspaceId: ws.id };
  }

  private async nameOf(tx: Tx, c: CallRow): Promise<string> {
    if (!c.staffId) return c.contactName ?? 'They';
    const [p] = await tx.select({ name: staff.name }).from(staff).where(eq(staff.id, c.staffId));
    return p?.name ?? 'They';
  }

  private async settings(tenantId: string) {
    const [t] = await this.db.tenant(tenantId, (tx) => tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)));
    return { ...DEFAULT_TENANT_SETTINGS.calls, ...t?.settings.calls };
  }
}

/** The call log's outcome and line for a result. */
function outcomeOf(result: FollowUpResult, name: string, loaded: Loaded): { outcome: CallOutcome; summary: string } {
  switch (result.kind) {
    case 'settled':
      return { outcome: 'settled', summary: `${name} says it is settled: "${result.said}"` };
    case 'promise':
      return { outcome: 'promised', summary: `${name} promised ${sayDay(result.promiseOn, loaded.ctx.now)}.` };
    case 'dispute':
      return { outcome: 'disputed', summary: `${name} disputes it: "${result.said}"` };
    case 'wrong_number':
      return { outcome: 'wrong_number', summary: 'Wrong number. It will not be called again.' };
    case 'do_not_call':
      return { outcome: 'do_not_call', summary: `${name} asked not to be called again.` };
    case 'status':
      return { outcome: 'updated', summary: `Updated from what ${name.split(' ')[0]} said: "${result.said}"` };
    case 'said':
      return { outcome: 'noted', summary: `${name} said: "${result.said}"` };
  }
}
