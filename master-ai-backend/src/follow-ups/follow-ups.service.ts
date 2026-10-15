import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import type { FollowUpInfo, ResolvedPack } from '@onehuman/schemas';
import { normalizeSnapshot, registersOf, titleOf, type ResolvedFollowUp, type ResolvedRegister } from '@onehuman/agent-kit';
import { AuditService, SYSTEM } from '../audit/audit.service';
import type { Session } from '../common/auth';
import { DEFAULT_TENANT_SETTINGS } from '../common/mappers';
import { DbService, type Tx } from '../db/db.service';
import { calls, doNotCall, followUpAttempts, followUpSwitches, principals, recordNotes, staff, tenants } from '../db/schema';
import { dueSql } from '../lists/sql';
import { NotesService } from '../notes/notes.service';
import { TemporalService } from '../orchestration/temporal.service';
import { RecordsService } from '../records/records.service';
import { lowerFirst } from '../voice/spoken';
import { addDaysTo, istDate, narrowHours, withinHours } from '../voice/time';
import { contactName, matchStaff, phoneKey, readPath } from './targets';

type StaffRow = typeof staff.$inferSelect;
type Workspace = { id: string; status: string; pack: ResolvedPack };
/** `updated_at` as Postgres text, to the microsecond: the cursor for the next page. */
type Candidate = { id: string; data: Record<string, unknown>; tries: number | null; updated_at: string };
type Target = { kind: 'party'; name: string; phone: string } | { kind: 'staff'; person: StaffRow } | { kind: 'stop'; why: string };

/** A follow-up call older than this no longer counts as the one live call (a crashed workflow must not block every follow-up). */
const LIVE_MS = 30 * 60_000;
/** Due items read at a time while looking for one to call about. */
const PAGE = 100;
const SYSTEM_SPEAKER = 'ONEHUMAN OS';

/**
 * Follow-up calls on open list items: their switches (all off until switched
 * on; owner only for calls to outside parties), the company's half-hourly
 * sweep, and picking the next item to call about — one call at a time, inside
 * calling hours, up to the day's cap, never to a do-not-call number.
 */
@Injectable()
export class FollowUpsService {
  private readonly logger = new Logger(FollowUpsService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly records: RecordsService,
    private readonly notes: NotesService,
    private readonly temporal: TemporalService,
  ) {}

  async forList(session: Session, listId: string): Promise<FollowUpInfo[]> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = registersOf(ws.pack).find((r) => r.id === listId);
      if (!reg) throw new NotFoundException('List not found');
      const switches = await tx.select().from(followUpSwitches).where(eq(followUpSwitches.workspaceId, ws.id));
      const changers = switches.map((x) => x.changedBy).filter((x): x is string => !!x);
      const names = new Map(
        changers.length
          ? (await tx.select({ id: principals.id, name: principals.displayName }).from(principals).where(inArray(principals.id, changers))).map((p) => [p.id, p.name] as const)
          : [],
      );
      const now = new Date();
      const clock = { now, today: istDate(now) };
      const out: FollowUpInfo[] = [];
      for (const f of reg.followUps) {
        const sw = switches.find((x) => x.followUp === f.key);
        const [n] = (
          await tx.execute<{ due: number; waiting: number; stopped: number }>(sql`
            select count(*) filter (where ${dueSql(f, reg.entity, clock)} and (a.id is null or (a.state = 'active' and a.next_due_on <= ${clock.today}::date))
                     and not exists (select 1 from record_notes n where n.record_id = r.id and n.status = 'new'))::int as due,
                   count(*) filter (where a.state = 'waiting_for_you')::int as waiting,
                   count(*) filter (where a.state = 'stopped')::int as stopped
            from records r left join follow_up_attempts a on a.record_id = r.id and a.follow_up = ${f.key}
            where r.workspace_id = ${ws.id} and r.entity = ${reg.entity.name} and r.source <> 'sample'`)
        ).rows;
        out.push({
          key: f.key,
          id: f.id,
          label: f.label,
          who: f.who,
          enabled: sw?.enabled ?? false,
          changedBy: sw?.changedBy ? (names.get(sw.changedBy) ?? 'Someone') : null,
          changedAt: sw ? sw.changedAt.toISOString() : null,
          canSwitch: f.who === 'staff' || session.role === 'owner',
          due: Number(n?.due ?? 0),
          waiting: Number(n?.waiting ?? 0),
          stopped: Number(n?.stopped ?? 0),
        });
      }
      return out;
    });
  }

  async switch(session: Session, key: string, enabled: boolean): Promise<FollowUpInfo> {
    const { listId, anyOn } = await this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const f = registersOf(ws.pack)
        .flatMap((r) => r.followUps)
        .find((x) => x.key === key);
      if (!f) throw new NotFoundException('Follow-up not found');
      if (f.who === 'party' && session.role !== 'owner') throw new ForbiddenException('Only the owner can switch on calls to customers and suppliers');
      const at = new Date();
      await tx
        .insert(followUpSwitches)
        .values({ tenantId: session.tenantId, workspaceId: ws.id, followUp: key, enabled, changedBy: session.principalId, changedAt: at })
        .onConflictDoUpdate({
          target: [followUpSwitches.tenantId, followUpSwitches.workspaceId, followUpSwitches.followUp],
          set: { enabled, changedBy: session.principalId, changedAt: at },
        });
      await this.audit.append(tx, session.tenantId, {
        type: 'followup.switched',
        actor: { id: session.principalId, kind: 'human' },
        refId: ws.id,
        payload: { key, label: f.label, who: f.who, enabled },
      });
      const [on] = await tx.select({ n: count() }).from(followUpSwitches).where(and(eq(followUpSwitches.workspaceId, ws.id), eq(followUpSwitches.enabled, true)));
      return { listId: f.registerId, anyOn: Number(on?.n ?? 0) > 0 };
    });
    try {
      await this.temporal.syncFollowUpSchedule({ tenantId: session.tenantId, active: anyOn });
    } catch (err) {
      this.logger.error(`Could not schedule follow-ups for ${session.tenantId}: ${(err as Error).message}`);
    }
    return (await this.forList(session, listId)).find((x) => x.key === key)!;
  }

  async runNow(session: Session): Promise<{ ok: true }> {
    await this.temporal.startFollowUpSweep({ tenantId: session.tenantId, trigger: 'manual' });
    return { ok: true };
  }

  /**
   * The sweep's next call, or null. Nothing is called while the company is
   * paused, once today's cap is reached, or while another follow-up call is
   * live. The first switched-on follow-up with a due item inside calling hours
   * wins: the item gets an attempt and a scheduled call. Items with no phone or
   * no matching team member stop with a note, so they leave the queue. A number
   * or team member already called today is not called again until tomorrow, so
   * five overdue bills from one party are five calls on five days.
   */
  async pick(tenantId: string): Promise<{ callId: string } | null> {
    return this.db.tenant(tenantId, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`follow-ups:${tenantId}`}))`);
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
      if (!tenant || tenant.status === 'paused') return null;
      const s = { ...DEFAULT_TENANT_SETTINGS.calls, ...tenant.settings.calls };
      const now = new Date();
      const clock = { now, today: istDate(now) };
      const [live] = await tx
        .select({ n: count() })
        .from(calls)
        .where(and(eq(calls.stage, 'chase'), inArray(calls.status, ['scheduled', 'ringing', 'in_progress']), gt(calls.createdAt, new Date(now.getTime() - LIVE_MS))));
      if (Number(live?.n ?? 0) > 0) return null;
      const [made] = await tx
        .select({ n: count() })
        .from(calls)
        .where(and(eq(calls.stage, 'chase'), sql`(${calls.createdAt} at time zone 'Asia/Kolkata')::date = ${clock.today}::date`));
      if (Number(made?.n ?? 0) >= s.followUpsPerDay) return null;

      const ws = await this.workspace(tx);
      if (ws.status === 'paused') return null;
      const on = new Set(
        (await tx.select().from(followUpSwitches).where(and(eq(followUpSwitches.workspaceId, ws.id), eq(followUpSwitches.enabled, true)))).map((x) => x.followUp),
      );
      if (!on.size) return null;
      const anyHours = s.fastSchedule && s.provider === 'simulator';
      const blocked = new Set((await tx.select({ phone: doNotCall.phone }).from(doNotCall)).map((d) => d.phone));
      const people = await tx.select().from(staff);
      // At most one follow-up call a day to each number and each team member.
      const calledToday = await tx
        .select({ phone: calls.contactPhone, staffId: calls.staffId })
        .from(calls)
        .where(and(eq(calls.stage, 'chase'), ne(calls.status, 'cancelled'), sql`(${calls.createdAt} at time zone 'Asia/Kolkata')::date = ${clock.today}::date`));
      const phonesToday = new Set(calledToday.flatMap((c) => (c.phone ? [phoneKey(c.phone)] : [])));
      const staffToday = new Set(calledToday.flatMap((c) => (c.staffId ? [c.staffId] : [])));

      for (const reg of registersOf(ws.pack)) {
        for (const f of reg.followUps.filter((x) => on.has(x.key))) {
          if (f.who === 'party' && !anyHours && !withinHours(now, narrowHours(s.partyHours, f.hours))) continue;
          // A page at a time, so items of numbers already called today can't hide the rest.
          for (let after: Candidate | null = null; ; ) {
            const rows: Candidate[] = (
              await tx.execute<Candidate>(sql`
                select r.id, r.data, a.tries, r.updated_at::text as updated_at from records r
                left join follow_up_attempts a on a.record_id = r.id and a.follow_up = ${f.key}
                where r.workspace_id = ${ws.id} and r.entity = ${reg.entity.name} and r.source <> 'sample'
                  and ${dueSql(f, reg.entity, clock)}
                  and (a.id is null or (a.state = 'active' and a.next_due_on <= ${clock.today}::date))
                  and not exists (select 1 from record_notes n where n.record_id = r.id and n.status = 'new')
                  ${after ? sql`and (r.updated_at, r.id) > (${after.updated_at}::timestamptz, ${after.id}::uuid)` : sql``}
                order by r.updated_at asc, r.id asc
                limit ${PAGE}`)
            ).rows;
            for (const item of rows) {
              const target = await this.target(tx, ws, reg, f, item, people);
              if (target.kind === 'stop') {
                await this.stop(tx, tenantId, f, item.id, target.why, clock.today);
                continue;
              }
              if (target.kind === 'party' && (blocked.has(phoneKey(target.phone)) || phonesToday.has(phoneKey(target.phone)))) continue;
              if (target.kind === 'staff' && (staffToday.has(target.person.id) || (!anyHours && !withinHours(now, target.person.workingHours)))) continue;
              return { callId: await this.schedule(tx, tenantId, s.provider, reg, f, item, target, clock.today) };
            }
            if (rows.length < PAGE) break;
            after = rows.at(-1)!;
          }
        }
      }
      return null;
    });
  }

  private async target(tx: Tx, ws: Workspace, reg: ResolvedRegister, f: ResolvedFollowUp, item: Candidate, people: StaffRow[]): Promise<Target> {
    const title = titleOf(reg.entity, item.data);
    if (f.who === 'staff') {
      const name = String(item.data[f.staffField!.name] ?? '').trim();
      if (!name) return { kind: 'stop', why: `Nobody is named in ${lowerFirst(f.staffField!.label)} for ${title}, so there is nobody to call. Please follow it up yourself.` };
      const person = matchStaff(people, name);
      return person ? { kind: 'staff', person } : { kind: 'stop', why: `Couldn't find ${name} in your team. Add them on the Team page, or follow ${title} up yourself.` };
    }
    const phone = f.phone ? await readPath(tx, ws.id, f.phone, item.data) : null;
    const name = (await contactName(tx, ws.id, f, item.data)) ?? title;
    if (!phone || phoneKey(phone).length < 10) return { kind: 'stop', why: `There is no phone number to call ${name} about ${title}. Please add one or follow it up yourself.` };
    return { kind: 'party', name, phone };
  }

  /** The follow-up stops for this item, and the head gets a note saying why. */
  private async stop(tx: Tx, tenantId: string, f: ResolvedFollowUp, recordId: string, why: string, today: string) {
    await tx
      .insert(followUpAttempts)
      .values({ tenantId, recordId, followUp: f.key, nextDueOn: today, state: 'stopped' })
      .onConflictDoUpdate({ target: [followUpAttempts.recordId, followUpAttempts.followUp], set: { state: 'stopped' } });
    await this.notes.create(tx, tenantId, { recordId, callId: null, followUp: f.key, kind: 'unreachable', speaker: SYSTEM_SPEAKER, said: why });
  }

  private async schedule(tx: Tx, tenantId: string, provider: string, reg: ResolvedRegister, f: ResolvedFollowUp, item: Candidate, target: Exclude<Target, { kind: 'stop' }>, today: string): Promise<string> {
    // Tomorrow until the call finishes and says otherwise, so a call that dies half way is not rung again today.
    const tomorrow = addDaysTo(today, 1);
    await tx
      .insert(followUpAttempts)
      .values({ tenantId, recordId: item.id, followUp: f.key, nextDueOn: tomorrow, lastCallAt: new Date() })
      .onConflictDoUpdate({ target: [followUpAttempts.recordId, followUpAttempts.followUp], set: { nextDueOn: tomorrow, lastCallAt: new Date() } });
    const [call] = await tx
      .insert(calls)
      .values({
        tenantId,
        stage: 'chase',
        attempt: (item.tries ?? 0) + 1,
        status: 'scheduled',
        provider,
        recordId: item.id,
        followUp: f.key,
        ...(target.kind === 'staff' ? { staffId: target.person.id } : { contactName: target.name, contactPhone: target.phone }),
        extracted: { about: { listId: reg.id, itemId: item.id, title: titleOf(reg.entity, item.data) } },
      })
      .returning();
    await this.audit.append(tx, tenantId, {
      type: 'call.scheduled',
      actor: SYSTEM,
      refId: call!.id,
      payload: {
        staffName: target.kind === 'staff' ? target.person.name : target.name,
        stage: 'chase',
        followUp: f.key,
        title: titleOf(reg.entity, item.data),
        attempt: call!.attempt,
      },
    });
    return call!.id;
  }

  /** Why a planned call must not ring now, or null when it may. `place` asks again just before dialling. */
  async blocker(tx: Tx, c: typeof calls.$inferSelect): Promise<string | null> {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, c.tenantId));
    if (!tenant || tenant.status === 'paused') return 'The company is paused.';
    const ws = await this.workspace(tx);
    if (ws.status === 'paused') return 'The workspace is paused.';
    const [sw] = await tx.select().from(followUpSwitches).where(and(eq(followUpSwitches.workspaceId, ws.id), eq(followUpSwitches.followUp, c.followUp ?? '')));
    if (!sw?.enabled) return 'The follow-up was switched off.';
    const reg = registersOf(ws.pack).find((r) => r.followUps.some((x) => x.key === c.followUp));
    const f = reg?.followUps.find((x) => x.key === c.followUp);
    if (!reg || !f || !c.recordId) return 'The follow-up is no longer in your setup.';
    const now = new Date();
    if (now.getTime() - c.createdAt.getTime() > LIVE_MS) return 'The call waited too long to ring.';
    const s = { ...DEFAULT_TENANT_SETTINGS.calls, ...tenant.settings.calls };
    // The fast schedule ignores hours only for a simulated call: a call planned while real calls were on rings through Twilio.
    const anyHours = s.fastSchedule && s.provider === 'simulator' && c.provider === 'simulator';
    if (c.staffId) {
      const [person] = await tx.select().from(staff).where(eq(staff.id, c.staffId));
      if (!person || person.status !== 'active') return 'The team member is no longer active.';
      if (!anyHours && !withinHours(now, person.workingHours)) return `It is outside ${person.name}'s working hours.`;
    } else {
      if (!anyHours && !withinHours(now, narrowHours(s.partyHours, f.hours))) return 'It is outside calling hours.';
      const [blocked] = c.contactPhone ? await tx.select().from(doNotCall).where(eq(doNotCall.phone, phoneKey(c.contactPhone))) : [];
      if (blocked) return 'The number is on the do-not-call list.';
    }
    const [waiting] = await tx.select({ id: recordNotes.id }).from(recordNotes).where(and(eq(recordNotes.recordId, c.recordId), eq(recordNotes.status, 'new'))).limit(1);
    if (waiting) return 'A note on the item is waiting for you.';
    const clock = { now, today: istDate(now) };
    const due = await tx.execute(sql`select 1 from records r where r.id = ${c.recordId} and r.workspace_id = ${ws.id} and ${dueSql(f, reg.entity, clock)}`);
    if (!due.rows.length) return 'The item no longer needs a call.';
    return null;
  }

  private async workspace(tx: Tx): Promise<Workspace> {
    const ws = await this.records.activeWorkspace(tx);
    return { id: ws.id, status: ws.status, pack: normalizeSnapshot(ws.pack) };
  }
}
