import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import type {
  CheckinEntry,
  CheckinInput,
  CheckinValue,
  CreateRoutineInput,
  Routine,
  RoutineDay,
  RoutineDaySummary,
  RoutineQuestion,
  RoutineTemplateInfo,
  TranscriptLine,
  UpdateRoutineInput,
} from '@onehuman/schemas';
import { collectAsk, normalizeSnapshot, registersOf } from '@onehuman/agent-kit';
import { AuditService, SYSTEM } from '../audit/audit.service';
import type { Session } from '../common/auth';
import { DEFAULT_TENANT_SETTINGS } from '../common/mappers';
import { DbService, type Tx } from '../db/db.service';
import { calls, principals, routineEntries, routines, staff, tenants, workspaces } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { TemporalService } from '../orchestration/temporal.service';
import { toCall } from '../voice/call-record';
import { newCollectState } from '../voice/collect-engine';
import {
  CheckinEngine,
  checkinSummary,
  checkinSuggestions,
  flagsOf,
  nextQuestion,
  simulatedCheckinReply,
  type CheckinContext,
} from '../voice/checkin-engine';
import { ANY_HOURS, istDate, nextCallableTime, nextRunAt } from '../voice/time';
import { TwilioService } from '../voice/twilio';
import { CollectionService } from './collection.service';

type RoutineRow = typeof routines.$inferSelect;
type EntryRow = typeof routineEntries.$inferSelect;
type StaffRow = typeof staff.$inferSelect;
type CallRow = typeof calls.$inferSelect;

/** Calls that would start later than this after the routine's time are skipped: the day's report is missed. */
const TOO_LATE_MS = 3 * 3_600_000;
const RING_SECONDS = 40;

/**
 * Routines: repeating check-ins (daily work report, stock check…) that run
 * by hand or by phone. In automatic mode the AI phones everyone at the
 * routine's time; in manual mode people fill it in in the app and, if they
 * have not by then, the AI phones them. Answers land in the day's entries;
 * problems they mention go to the owner.
 */
@Injectable()
export class RoutinesService {
  private readonly logger = new Logger(RoutinesService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly engine: CheckinEngine,
    private readonly temporal: TemporalService,
    private readonly notifications: NotificationsService,
    private readonly twilio: TwilioService,
    private readonly collection: CollectionService,
  ) {}

  // ---------- reads ----------

  /** Routines the installed industry pack offers, and whether each is already switched on. */
  async templates(tenantId: string): Promise<RoutineTemplateInfo[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const pack = normalizeSnapshot(ws.pack);
      const lists = registersOf(pack);
      const used = new Set((await tx.select({ t: routines.templateId }).from(routines)).map((r) => r.t));
      return pack.routines.flatMap<RoutineTemplateInfo>((t) => {
        if (!t.collect) return [{ ...t, inUse: used.has(t.id), listLabel: null, askLabels: [] }];
        const reg = lists.find((l) => l.id === t.collect!.list);
        return reg ? [{ ...t, inUse: used.has(t.id), listLabel: reg.label, askLabels: collectAsk(reg, t.collect).map((f) => f.label) }] : [];
      });
    });
  }

  async list(tenantId: string): Promise<Routine[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const rows = await tx.select().from(routines).orderBy(asc(routines.createdAt));
      const people = await tx.select().from(staff);
      const today = istDate();
      const entries = rows.length
        ? await tx.select().from(routineEntries).where(and(inArray(routineEntries.routineId, rows.map((r) => r.id)), eq(routineEntries.date, today)))
        : [];
      return rows.map((r) => toRoutine(r, people, entries.filter((e) => e.routineId === r.id), today));
    });
  }

  /** One routine's day: everyone's entry (pending ones included), the summary and recent days. */
  async day(tenantId: string, routineId: string, date = istDate()): Promise<RoutineDay> {
    return this.db.tenant(tenantId, async (tx) => {
      const r = await this.routine(tx, routineId);
      const people = await tx.select().from(staff);
      const since = istDate(new Date(Date.now() - 14 * 86_400_000));
      const recent = await tx
        .select()
        .from(routineEntries)
        .where(and(eq(routineEntries.routineId, routineId), gte(routineEntries.date, since)))
        .orderBy(desc(routineEntries.date));
      const todays = recent.filter((e) => e.date === date);
      const callRows = todays.length
        ? await tx.select().from(calls).where(inArray(calls.checkinId, todays.map((e) => e.id))).orderBy(asc(calls.createdAt))
        : [];
      const reporters = people.filter((p) => r.staffIds.includes(p.id));
      const entries: CheckinEntry[] = reporters.map((p) => {
        const e = todays.find((x) => x.staffId === p.id);
        return toEntry(r, p, e ?? null, date, callRows.filter((c) => e && c.checkinId === e.id));
      });
      const dates = [...new Set(recent.map((e) => e.date))].filter((d) => d !== date).slice(0, 10);
      return {
        routine: toRoutine(r, people, todays, istDate()),
        date,
        entries,
        summary: summarize(r, reporters, todays, date),
        history: dates.map((d) => summarize(r, reporters, recent.filter((e) => e.date === d), d)),
      };
    });
  }

  // ---------- writes ----------

  async create(session: Session, input: CreateRoutineInput): Promise<Routine> {
    const routine = await this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const template = input.templateId ? (ws.pack.routines ?? []).find((t) => t.id === input.templateId) : undefined;
      if (input.templateId && !template) throw new NotFoundException('That check-in is not part of your industry setup');
      const collect = template?.collect ? this.collection.snapshot(ws.pack, template.collect) : null;
      const questions = collect ? [] : (input.questions ?? template?.questions);
      const name = input.name ?? template?.name;
      if (!name || (!collect && !questions?.length)) throw new BadRequestException('A routine needs a name and at least one question');
      if (collect && !input.staffIds?.length) throw new BadRequestException(`Pick who the AI calls for ${name}`);
      const team = await tx.select().from(staff).where(eq(staff.status, 'active'));
      const [row] = await tx
        .insert(routines)
        .values({
          tenantId: session.tenantId,
          workspaceId: ws.id,
          templateId: template?.id ?? null,
          name,
          description: input.description ?? template?.description ?? '',
          mode: input.mode ?? template?.mode ?? 'automatic',
          days: input.days ?? template?.days ?? [1, 2, 3, 4, 5, 6],
          time: input.time ?? template?.time ?? '18:00',
          chaseMissing: input.chaseMissing ?? true,
          questions: questions as RoutineQuestion[],
          collect,
          staffIds: input.staffIds ?? team.map((p) => p.id),
        })
        .returning();
      await this.audit.append(tx, session.tenantId, {
        type: 'routine.created',
        actor: { id: session.principalId, kind: 'human' },
        refId: row!.id,
        payload: { name, mode: row!.mode, time: row!.time, days: row!.days, people: row!.staffIds.length },
      });
      return row!;
    });
    await this.syncSchedule(routine);
    return (await this.list(session.tenantId)).find((r) => r.id === routine.id)!;
  }

  async update(session: Session, routineId: string, input: UpdateRoutineInput): Promise<Routine> {
    const routine = await this.db.tenant(session.tenantId, async (tx) => {
      await this.routine(tx, routineId);
      const { questions, ...rest } = input;
      const [row] = await tx
        .update(routines)
        .set({ ...rest, ...(questions && { questions: questions as RoutineQuestion[] }), updatedAt: new Date() })
        .where(eq(routines.id, routineId))
        .returning();
      await this.audit.append(tx, session.tenantId, {
        type: 'routine.updated',
        actor: { id: session.principalId, kind: 'human' },
        refId: routineId,
        payload: { name: row!.name, ...input },
      });
      return row!;
    });
    if (input.days || input.time || input.status) await this.syncSchedule(routine);
    return (await this.list(session.tenantId)).find((r) => r.id === routineId)!;
  }

  /** Someone filled in today's check-in by hand (or the owner corrected it). */
  async submit(session: Session, routineId: string, input: CheckinInput): Promise<RoutineDay> {
    await this.db.tenant(session.tenantId, async (tx) => {
      const r = await this.routine(tx, routineId);
      if (!r.staffIds.includes(input.staffId)) throw new BadRequestException('That person is not part of this routine');
      const [person] = await tx.select().from(staff).where(eq(staff.id, input.staffId));
      const values = r.collect
        ? { items: Math.max(0, Math.round(Number(input.values.items) || 0)), differences: 0 }
        : cleanValues(r.questions, input.values as Record<string, CheckinValue>);
      const missing = r.collect ? [] : r.questions.filter((q) => q.required && (values[q.key] === undefined || values[q.key] === null || values[q.key] === ''));
      if (missing.length) throw new BadRequestException(`Please answer: ${missing.map((q) => q.label).join(', ')}`);
      const date = istDate();
      const flags = flagsOf(r.questions, values);
      await tx
        .insert(routineEntries)
        .values({ tenantId: session.tenantId, routineId, staffId: input.staffId, date, status: 'reported', source: 'manual', values, flags })
        .onConflictDoUpdate({
          target: [routineEntries.routineId, routineEntries.staffId, routineEntries.date],
          set: { status: 'reported', source: 'manual', values, flags, updatedAt: new Date() },
        });
      await this.audit.append(tx, session.tenantId, {
        type: 'checkin.reported',
        actor: { id: session.principalId, kind: 'human' },
        refId: routineId,
        payload: { name: r.name, staffName: person?.name, source: 'manual', flags: flags.length },
      });
    });
    return this.day(session.tenantId, routineId);
  }

  async runNow(session: Session, routineId: string) {
    await this.db.tenant(session.tenantId, (tx) => this.routine(tx, routineId));
    await this.temporal.startRoutineRun({ tenantId: session.tenantId, routineId, trigger: 'manual' });
    return { ok: true as const };
  }

  private async syncSchedule(r: RoutineRow) {
    try {
      await this.temporal.syncRoutineSchedule({ tenantId: r.tenantId, routineId: r.id, days: r.days, time: r.time, active: r.status === 'active' });
    } catch (err) {
      this.logger.error(`Could not schedule routine ${r.id}: ${(err as Error).message}`);
    }
  }

  // ---------- run: activities for routineRunWorkflow and checkinCallWorkflow ----------

  /**
   * Today's run: make sure everyone has an entry, then decide who gets a call.
   * Automatic mode, or manual mode with chasing on, calls everyone who has not
   * reported yet; otherwise the missing ones are just marked missed.
   */
  async startRun(tenantId: string, routineId: string, trigger: 'schedule' | 'manual'): Promise<{ name: string; entryIds: string[] }> {
    return this.db.tenant(tenantId, async (tx) => {
      const r = await this.routine(tx, routineId);
      if (r.status === 'paused' && trigger === 'schedule') return { name: r.name, entryIds: [] };
      const date = istDate();
      const active = (await tx.select().from(staff).where(eq(staff.status, 'active'))).filter((p) => r.staffIds.includes(p.id));
      if (active.length) {
        await tx
          .insert(routineEntries)
          .values(active.map((p) => ({ tenantId, routineId, staffId: p.id, date })))
          .onConflictDoNothing();
      }
      const open = (await tx.select().from(routineEntries).where(and(eq(routineEntries.routineId, routineId), eq(routineEntries.date, date)))).filter(
        (e) => (e.status === 'pending' || e.status === 'missed') && active.some((p) => p.id === e.staffId),
      );
      const call = r.mode === 'automatic' || r.chaseMissing;
      if (open.length) {
        await tx
          .update(routineEntries)
          .set({ status: call ? 'calling' : 'missed', updatedAt: new Date() })
          .where(inArray(routineEntries.id, open.map((e) => e.id)));
      }
      await this.audit.append(tx, tenantId, {
        type: 'routine.run_started',
        actor: SYSTEM,
        refId: routineId,
        payload: { name: r.name, trigger, calling: call ? open.length : 0, expected: active.length },
      });
      return { name: r.name, entryIds: call ? open.map((e) => e.id) : [] };
    });
  }

  async plan(tenantId: string) {
    const s = await this.callSettings(tenantId);
    const real = s.provider !== 'simulator';
    return {
      maxAttempts: s.maxAttempts,
      retryMs: s.fastSchedule ? (real ? 60_000 : 5_000) : s.retryMinutes * 60_000,
      ringTimeoutMs: real ? 90_000 : 45_000,
      talkTimeoutMs: 15 * 60_000,
    };
  }

  /** Milliseconds to wait before calling; -1 to stop (already reported, or too late today). */
  async waitBeforeCall(tenantId: string, entryId: string): Promise<number> {
    return this.db.tenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ e: routineEntries, tenant: tenants })
        .from(routineEntries)
        .innerJoin(tenants, eq(tenants.id, routineEntries.tenantId))
        .where(eq(routineEntries.id, entryId));
      if (!row || row.e.status === 'reported') return -1;
      const s = { ...DEFAULT_TENANT_SETTINGS.calls, ...row.tenant.settings.calls };
      if (row.tenant.status === 'paused') return s.fastSchedule ? 5_000 : 5 * 60_000;
      if (s.fastSchedule && s.provider === 'simulator') return 0;
      // Evening reports may go past working hours, never outside 9:00–21:00.
      const now = new Date();
      const wait = nextCallableTime(now, ANY_HOURS).getTime() - now.getTime();
      return wait > TOO_LATE_MS ? -1 : Math.max(0, wait);
    });
  }

  /** Ring the person. Auto-simulated calls finish at once; others wait for answer/reply/decline. */
  async placeCall(tenantId: string, entryId: string, attempt: number): Promise<{ callId: string | null; done: boolean }> {
    const s = await this.callSettings(tenantId);
    const placed = await this.db.tenant(tenantId, async (tx) => {
      const { r, e, person } = await this.entry(tx, entryId);
      if (e.status === 'reported') return null;
      const [call] = await tx
        .insert(calls)
        .values({ tenantId, checkinId: entryId, staffId: e.staffId, stage: r.collect ? 'collect' : 'checkin', attempt, status: 'ringing', provider: s.provider, extracted: r.collect ? { collect: newCollectState() } : { values: e.values } })
        .returning();
      await this.audit.append(tx, tenantId, {
        type: 'call.ringing',
        actor: SYSTEM,
        refId: call!.id,
        payload: { staffName: person.name, stage: r.collect ? 'collect' : 'checkin', attempt, routine: r.name, mode: s.provider === 'simulator' ? s.simulatorMode : s.provider },
      });
      return {
        callId: call!.id,
        phone: person.phone,
        r,
        person,
        ctx: r.collect ? null : await this.context(tx, r, person, e.values, {}, []),
        collect: r.collect ? await this.collection.context(tx, r, person, newCollectState(), []) : null,
      };
    });
    if (!placed) return { callId: null, done: true };
    const { callId, phone, ctx, collect, r, person } = placed;

    if (s.provider === 'twilio') {
      try {
        const sid = await this.twilio.placeCall({ to: phone, tenantId, callId, ringSeconds: RING_SECONDS });
        await this.db.tenant(tenantId, (tx) => tx.update(calls).set({ providerCallId: sid }).where(eq(calls.id, callId)));
      } catch (err) {
        this.logger.warn(`Check-in call ${callId} not placed: ${(err as Error).message}`);
        await this.endUnanswered(tenantId, callId, `Couldn't place the call. ${(err as Error).message}`);
        return { callId, done: true };
      }
      return { callId, done: false };
    }
    if (s.simulatorMode === 'interactive') return { callId, done: false };
    if (collect) {
      const done = await this.collection.simulate(tenantId, callId, r, person, collect);
      await this.collection.finish(tenantId, callId, done.transcript, done.state, done.callBack ? 'call_back' : 'ended');
      return { callId, done: true };
    }

    // Auto mode: a simulated person in charge answers every question.
    if (!ctx) throw new Error('Check-in call without a context');
    let transcript: TranscriptLine[] = [line('ai', this.engine.opening(ctx))];
    let state = { values: ctx.values, retries: ctx.retries };
    await this.db.tenant(tenantId, (tx) => tx.update(calls).set({ status: 'in_progress', startedAt: new Date(), transcript }).where(eq(calls.id, callId)));
    for (let turn = 0; turn < 12; turn++) {
      const reply = simulatedCheckinReply({ ...ctx, ...state });
      const res = await this.engine.turn({ ...ctx, ...state, transcript }, reply);
      transcript = [...transcript, line('person', reply), line('ai', res.say)];
      state = { values: res.values, retries: res.retries };
      if (res.end) break;
    }
    await this.finishCall(tenantId, callId, transcript, state.values, false);
    return { callId, done: true };
  }

  async callResult(tenantId: string, entryId: string, callId: string | null) {
    return this.db.tenant(tenantId, async (tx) => {
      const [e] = await tx.select().from(routineEntries).where(eq(routineEntries.id, entryId));
      const [c] = callId ? await tx.select().from(calls).where(eq(calls.id, callId)) : [];
      return { reported: e?.status === 'reported', callBack: c?.outcome === 'call_back' };
    });
  }

  /** Nobody answered (or the call was cut off, or could not be placed). */
  async endUnanswered(tenantId: string, callId: string, failure?: string) {
    const [c] = await this.db.tenant(tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, callId)));
    if (!c) return;
    if (c.status === 'in_progress') {
      // Keep whatever was answered (or taken down) before the line dropped.
      if (c.stage === 'collect') await this.collection.finish(tenantId, callId, c.transcript, c.extracted.collect ?? newCollectState(), 'dropped');
      else await this.finishCall(tenantId, callId, c.transcript, c.extracted.values ?? {}, true);
      return;
    }
    if (c.status !== 'ringing') return;
    await this.db.tenant(tenantId, async (tx) => {
      const [person] = await tx.select().from(staff).where(eq(staff.id, c.staffId!));
      await tx
        .update(calls)
        .set({ status: failure ? 'failed' : 'no_answer', endedAt: new Date(), outcome: 'no_answer', summary: failure ?? `${person?.name ?? 'They'} didn't answer.` })
        .where(eq(calls.id, callId));
      await this.audit.append(tx, tenantId, { type: 'call.no_answer', actor: SYSTEM, refId: callId, payload: { staffName: person?.name, stage: 'checkin', attempt: c.attempt } });
    });
  }

  /** Every attempt failed: the day's update is missing. */
  async markMissed(tenantId: string, entryId: string) {
    await this.db.tenant(tenantId, async (tx) => {
      const { r, e, person } = await this.entry(tx, entryId);
      if (e.status === 'reported') return;
      await tx.update(routineEntries).set({ status: 'missed', updatedAt: new Date() }).where(eq(routineEntries.id, entryId));
      await this.audit.append(tx, tenantId, { type: 'checkin.missed', actor: SYSTEM, refId: r.id, payload: { name: r.name, staffName: person.name } });
    });
  }

  /** The run is over: summarise the day and tell the owner, problems first. */
  async finishRun(tenantId: string, routineId: string) {
    const summary = await this.db.tenant(tenantId, async (tx) => {
      const r = await this.routine(tx, routineId);
      const date = istDate();
      const people = (await tx.select().from(staff)).filter((p) => r.staffIds.includes(p.id));
      const entries = await tx.select().from(routineEntries).where(and(eq(routineEntries.routineId, routineId), eq(routineEntries.date, date)));
      const s = summarize(r, people, entries, date);
      await this.audit.append(tx, tenantId, {
        type: 'routine.run_finished',
        actor: SYSTEM,
        refId: routineId,
        payload: { name: r.name, expected: s.expected, reported: s.reported, missed: s.missed, flags: s.flags.length },
      });
      return { name: r.name, s };
    });
    const { name, s } = summary;
    const missed = s.missed ? ` ${s.missed} missed.` : '';
    const body = s.flags.length ? `${s.flags.slice(0, 3).join(' · ')}${s.flags.length > 3 ? ` +${s.flags.length - 3} more` : ''}` : `${s.reported} of ${s.expected} reported, no problems.${missed}`;
    void this.notifications.pushToManagers(tenantId, { title: s.flags.length ? `${name}: ${s.flags.length} problem${s.flags.length === 1 ? '' : 's'}` : name, body, data: { routineId } });
  }

  // ---------- the conversation: simulator UI and provider webhooks ----------

  async answer(tenantId: string, call: CallRow) {
    const entryId = call.checkinId!;
    await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, call.id)).for('update');
      if (!c || c.status !== 'ringing') throw new ConflictException(`Call is ${c?.status.replace('_', ' ') ?? 'gone'}`);
      const { r, e, person } = await this.entry(tx, entryId);
      const opening = r.collect
        ? this.collection.opening(await this.collection.context(tx, r, person, c.extracted.collect ?? newCollectState(), []))
        : this.engine.opening(await this.context(tx, r, person, c.extracted.values ?? e.values, {}, []));
      await tx.update(calls).set({ status: 'in_progress', startedAt: new Date(), transcript: [line('ai', opening)] }).where(eq(calls.id, call.id));
    });
    await this.temporal.signalCheckin(entryId, { callId: call.id, event: 'answered' });
  }

  async reply(tenantId: string, call: CallRow, text: string) {
    const { c, r, person } = await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, call.id));
      if (!c || c.status !== 'in_progress') throw new BadRequestException('Answer the call first');
      const { r, person } = await this.entry(tx, c.checkinId!);
      return { c, r, person };
    });
    if (r.collect) {
      const ctx = await this.db.tenant(tenantId, (tx) => this.collection.context(tx, r, person, c.extracted.collect ?? newCollectState(), c.transcript));
      const res = await this.collection.turn(tenantId, call.id, r, person, ctx, text);
      const transcript = [...c.transcript, line('person', text), line('ai', res.say)];
      if (res.end) {
        await this.collection.finish(tenantId, call.id, transcript, res.state, res.callBack ? 'call_back' : 'ended');
        await this.temporal.signalCheckin(c.checkinId!, { callId: call.id, event: 'ended' });
      } else {
        await this.db.tenant(tenantId, (tx) => tx.update(calls).set({ transcript, extracted: { ...c.extracted, collect: res.state } }).where(eq(calls.id, call.id)));
      }
      return;
    }
    const ctx = await this.db.tenant(tenantId, (tx) => this.context(tx, r, person, c.extracted.values ?? {}, c.extracted.retries ?? {}, c.transcript));
    const res = await this.engine.turn(ctx, text);
    const transcript = [...c.transcript, line('person', text), line('ai', res.say)];
    if (res.end) {
      await this.finishCall(tenantId, call.id, transcript, res.values, res.callBack);
      await this.temporal.signalCheckin(c.checkinId!, { callId: call.id, event: 'ended' });
    } else {
      await this.db.tenant(tenantId, (tx) =>
        tx.update(calls).set({ transcript, extracted: { ...c.extracted, values: res.values, retries: res.retries } }).where(eq(calls.id, call.id)),
      );
    }
  }

  async decline(tenantId: string, call: CallRow) {
    await this.endUnanswered(tenantId, call.id);
    await this.temporal.signalCheckin(call.checkinId!, { callId: call.id, event: 'ended' });
  }

  /** Suggested replies for the simulator while a check-in call is on. */
  async suggestionsFor(tx: Tx, c: CallRow, person: StaffRow | null): Promise<string[]> {
    if (!c.checkinId || (c.status !== 'in_progress' && c.status !== 'ringing')) return [];
    const [row] = await tx.select({ r: routines }).from(routineEntries).innerJoin(routines, eq(routines.id, routineEntries.routineId)).where(eq(routineEntries.id, c.checkinId));
    if (!row) return [];
    if (row.r.collect) return this.collection.suggestions(await this.collection.context(tx, row.r, person!, c.extracted.collect ?? newCollectState(), c.transcript));
    return checkinSuggestions(row.r.questions, c.extracted.values ?? {}, person?.name ?? '');
  }

  /** Save what the call collected: the entry is reported once every required answer is in. */
  private async finishCall(tenantId: string, callId: string, transcript: TranscriptLine[], values: Record<string, CheckinValue>, callBack: boolean) {
    await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, callId));
      if (!c?.checkinId) return;
      const { r, e, person } = await this.entry(tx, c.checkinId);
      const merged = { ...e.values, ...values };
      const complete = !nextQuestion(r.questions, merged, true);
      const outcome = complete ? 'reported' : callBack ? 'call_back' : 'unclear';
      const summary = complete ? checkinSummary(r.questions, merged) : callBack ? `${person.name.split(' ')[0]} asked to be called back.` : 'The call ended before every answer was given.';
      await tx
        .update(calls)
        .set({ status: 'completed', endedAt: new Date(), transcript, outcome, summary, extracted: { ...c.extracted, values } })
        .where(eq(calls.id, callId));
      const flags = flagsOf(r.questions, merged);
      await tx
        .update(routineEntries)
        .set({ values: merged, flags, ...(complete && { status: 'reported' as const, source: 'call' as const }), updatedAt: new Date() })
        .where(eq(routineEntries.id, e.id));
      await this.audit.append(tx, tenantId, { type: 'call.completed', actor: SYSTEM, refId: callId, payload: { staffName: person.name, stage: 'checkin', outcome, summary } });
      if (complete) {
        await this.audit.append(tx, tenantId, {
          type: 'checkin.reported',
          actor: SYSTEM,
          refId: r.id,
          payload: { name: r.name, staffName: person.name, source: 'call', flags: flags.length },
        });
      }
    });
  }

  // ---------- helpers ----------

  private async context(
    tx: Tx,
    r: RoutineRow,
    person: StaffRow,
    values: Record<string, CheckinValue>,
    retries: Record<string, number>,
    transcript: TranscriptLine[],
  ): Promise<CheckinContext> {
    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, r.tenantId));
    const [owner] = await tx
      .select({ name: principals.displayName })
      .from(principals)
      .where(and(eq(principals.kind, 'human'), eq(principals.role, 'owner')))
      .limit(1);
    return {
      tenantId: r.tenantId,
      companyName: tenant?.name ?? 'the company',
      ownerName: owner?.name ?? 'the owner',
      staff: { name: person.name, title: person.title },
      routine: { name: r.name, questions: r.questions },
      values,
      retries,
      transcript,
    };
  }

  private async routine(tx: Tx, id: string) {
    const [r] = await tx.select().from(routines).where(eq(routines.id, id));
    if (!r) throw new NotFoundException('Routine not found');
    return r;
  }

  private async entry(tx: Tx, entryId: string) {
    const [row] = await tx
      .select({ e: routineEntries, r: routines, person: staff })
      .from(routineEntries)
      .innerJoin(routines, eq(routines.id, routineEntries.routineId))
      .innerJoin(staff, eq(staff.id, routineEntries.staffId))
      .where(eq(routineEntries.id, entryId));
    if (!row) throw new Error(`Check-in ${entryId} not found`);
    return row;
  }

  private async workspace(tx: Tx) {
    const [ws] = await tx.select().from(workspaces).orderBy(asc(workspaces.createdAt)).limit(1);
    if (!ws) throw new NotFoundException('Install an industry pack first');
    return ws;
  }

  private async callSettings(tenantId: string) {
    const [t] = await this.db.tenant(tenantId, (tx) => tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)));
    return { ...DEFAULT_TENANT_SETTINGS.calls, ...t?.settings.calls };
  }
}

function line(speaker: TranscriptLine['speaker'], text: string): TranscriptLine {
  return { speaker, text, at: new Date().toISOString() };
}

/** Keep only known answers, typed by their question. */
function cleanValues(questions: RoutineQuestion[], input: Record<string, CheckinValue>): Record<string, CheckinValue> {
  const out: Record<string, CheckinValue> = {};
  for (const q of questions) {
    const v = input[q.key];
    if (v === undefined) continue;
    if (q.type === 'number' || q.type === 'percent') {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      out[q.key] = v === null || String(v).trim() === '' || Number.isNaN(n) ? null : q.type === 'percent' ? Math.min(100, Math.max(0, n)) : n;
    } else if (q.type === 'yes_no') {
      out[q.key] = v === null ? null : v === true || v === 'true' || v === 'yes';
    } else {
      out[q.key] = v === null ? null : String(v).trim() || (q.flag ? 'none' : '');
    }
  }
  return out;
}

export function summarize(r: RoutineRow, people: StaffRow[], entries: EntryRow[], date: string): RoutineDaySummary {
  const mine = entries.filter((e) => people.some((p) => p.id === e.staffId));
  const reported = mine.filter((e) => e.status === 'reported');
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? 'Someone';
  const totals = r.collect
    ? [{ key: 'items', label: `${r.collect.listLabel} added`, value: reported.reduce((n, e) => n + Number(e.values.items ?? 0), 0) }]
    : r.questions
        .filter((q) => q.type === 'number' || q.type === 'percent')
        .map((q) => {
          const nums = reported.map((e) => e.values[q.key]).filter((v): v is number => typeof v === 'number');
          const value = q.type === 'number' ? nums.reduce((a, b) => a + b, 0) : nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
          return { key: q.key, label: q.type === 'percent' ? `Average ${q.label.toLowerCase()}` : q.label, value, ...(q.type === 'percent' ? { unit: '%' } : q.unit ? { unit: q.unit } : {}) };
        });
  return {
    date,
    expected: people.length,
    reported: reported.length,
    calling: mine.filter((e) => e.status === 'calling').length,
    missed: mine.filter((e) => e.status === 'missed').length,
    pending: people.length - mine.filter((e) => e.status !== 'pending').length,
    flags: mine.flatMap((e) => e.flags.map((f) => `${name(e.staffId)}: ${f}`)),
    totals,
  };
}

function toRoutine(r: RoutineRow, people: StaffRow[], todays: EntryRow[], today: string): Routine {
  const reporters = people.filter((p) => r.staffIds.includes(p.id));
  return {
    id: r.id,
    templateId: r.templateId,
    name: r.name,
    description: r.description,
    mode: r.mode,
    days: r.days,
    time: r.time,
    chaseMissing: r.chaseMissing,
    questions: r.questions,
    collect: r.collect ?? null,
    people: reporters.map((p) => ({ id: p.id, name: p.name, title: p.title })),
    status: r.status,
    nextRunAt: r.status === 'active' ? (nextRunAt(r.days, r.time)?.toISOString() ?? null) : null,
    today: summarize(r, reporters, todays, today),
    todayStatus: Object.fromEntries(reporters.map((p) => [p.id, todays.find((e) => e.staffId === p.id)?.status ?? 'pending'])),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toEntry(r: RoutineRow, p: StaffRow, e: EntryRow | null, date: string, callRows: CallRow[]): CheckinEntry {
  return {
    id: e?.id ?? '',
    routineId: r.id,
    staffId: p.id,
    staffName: p.name,
    staffTitle: p.title,
    date,
    status: e?.status ?? 'pending',
    source: e?.source ?? null,
    values: e?.values ?? {},
    flags: e?.flags ?? [],
    calls: callRows.map((c) => toCall(c, p, r.name)),
    updatedAt: (e?.updatedAt ?? r.updatedAt).toISOString(),
  };
}
