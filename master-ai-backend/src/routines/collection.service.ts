import { BadRequestException, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Collect, EntityDef, EntityField, ResolvedPack, RoutineCollect, TranscriptLine } from '@onehuman/schemas';
import { collectAsk, normalizeSnapshot, registersOf, titleOf, type ListCheck, type ResolvedRegister } from '@onehuman/agent-kit';
import { AuditService, SYSTEM } from '../audit/audit.service';
import { DbService, type Tx } from '../db/db.service';
import { calls, principals, records, routineEntries, routines, staff, tenants } from '../db/schema';
import { NotesService } from '../notes/notes.service';
import { RecordsService } from '../records/records.service';
import {
  CollectEngine,
  collectSuggestions,
  collectSummary,
  simulatedCollectReply,
  type CollectContext,
  type CollectMatch,
  type CollectState,
  type CollectTurn,
  type SaveResult,
} from '../voice/collect-engine';
import { lowerFirst, sayValue } from '../voice/spoken';
import { istDate } from '../voice/time';

type RoutineRow = typeof routines.$inferSelect;
type StaffRow = typeof staff.$inferSelect;

const line = (speaker: TranscriptLine['speaker'], text: string): TranscriptLine => ({ speaker, text, at: new Date().toISOString() });

/** A routine's defaults as values: `today` is the India date, `now` the moment. */
export function defaultsFor(defaults: Record<string, string | number | boolean>, entity: EntityDef, now: Date): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(defaults).map(([name, v]) => {
      const f = entity.fields.find((x) => x.name === name);
      if (v === 'today' && f?.type === 'date') return [name, istDate(now)];
      if (v === 'now' && f?.type === 'datetime') return [name, now.toISOString()];
      return [name, v];
    }),
  );
}

/** "On the call on 15 Oct, Ravi gave the total as ₹48,600 and the GST amount as ₹7,400". */
function differenceText(person: string, fields: EntityField[], item: Record<string, unknown>, now: Date): string {
  const day = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(now);
  const parts = fields.map((f) => `the ${lowerFirst(f.label)} as ${sayValue(f, item[f.name], {}, now)}`);
  const said = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `On the call on ${day}, ${person.split(' ')[0]} gave ${said}`;
}

/**
 * Collection routines: the AI takes down today's items for a list from the
 * person who keeps it. Each confirmed item is saved at once with source `call`
 * (not checked); one that repeats an item already on the list (its first
 * duplicate check) is not saved again, and different details become a
 * difference note for the head. The entry counts what the calls added.
 */
@Injectable()
export class CollectionService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly records: RecordsService,
    private readonly notes: NotesService,
    private readonly engine: CollectEngine,
  ) {}

  /** What a collection routine keeps from its template: the list and what it asks, with the labels as they are now. */
  snapshot(pack: ResolvedPack, c: Collect): RoutineCollect {
    const reg = registersOf(normalizeSnapshot(pack)).find((l) => l.id === c.list);
    if (!reg) throw new BadRequestException(`This routine adds to a list your setup doesn't have (${c.list})`);
    return {
      list: reg.id,
      entity: reg.entity.name,
      listLabel: reg.label,
      itemLabel: lowerFirst(reg.entity.label),
      ask: c.ask,
      defaults: c.defaults,
      maxItems: c.max_items,
      who: c.who ?? null,
    };
  }

  async context(tx: Tx, r: RoutineRow, person: StaffRow, state: CollectState, transcript: TranscriptLine[]): Promise<CollectContext> {
    const reg = await this.register(tx, r);
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
      listLabel: lowerFirst(reg.label),
      itemLabel: lowerFirst(reg.entity.label),
      fields: collectAsk(reg, r.collect!),
      maxItems: r.collect!.maxItems,
      state,
      transcript,
      now: new Date(),
    };
  }

  opening(ctx: CollectContext): string {
    return this.engine.opening(ctx);
  }

  /** One reply: the engine's turn, with lookups and saves against this company's records. */
  turn(tenantId: string, callId: string, r: RoutineRow, person: StaffRow, ctx: CollectContext, text: string): Promise<CollectTurn> {
    return this.engine.turn(ctx, text, {
      lookup: (entity, words) => this.lookup(tenantId, entity, words),
      save: (item) => this.save(tenantId, callId, r, person, item),
    });
  }

  /** The simulator's auto mode: a cooperative clerk answers until the call ends. */
  async simulate(tenantId: string, callId: string, r: RoutineRow, person: StaffRow, ctx: CollectContext) {
    let transcript: TranscriptLine[] = [line('ai', this.opening(ctx))];
    let state = ctx.state;
    let callBack = false;
    await this.db.tenant(tenantId, (tx) => tx.update(calls).set({ status: 'in_progress', startedAt: new Date(), transcript }).where(eq(calls.id, callId)));
    for (let i = 0; i < 80 && state.phase !== 'done'; i++) {
      const reply = simulatedCollectReply({ ...ctx, state, transcript });
      const res = await this.turn(tenantId, callId, r, person, { ...ctx, state, transcript }, reply);
      transcript = [...transcript, line('person', reply), line('ai', res.say)];
      state = res.state;
      callBack = res.callBack;
      if (res.end) break;
    }
    return { transcript, state, callBack };
  }

  /**
   * Saves what the call did. Items were saved as they were confirmed; the entry
   * is reported when the call ended normally, or dropped after at least one item.
   * A call-back leaves it open so the routine calls again.
   */
  async finish(tenantId: string, callId: string, passedTranscript: TranscriptLine[], passedState: CollectState, how: 'ended' | 'call_back' | 'dropped') {
    await this.db.tenant(tenantId, async (tx) => {
      // Locked, so a call that drops while an item is being confirmed is finished once, after any save in flight.
      const [c] = await tx.select().from(calls).where(eq(calls.id, callId)).for('update');
      if (!c?.checkinId || c.status === 'completed') return;
      // The newest state wins: the call row's, if it holds at least as many items and differences as the one passed in (a drop can arrive with an older read).
      const taken = (s: CollectState) => s.saved.length + s.differences;
      const stored = c.extracted.collect;
      const useStored = !!stored && taken(stored) >= taken(passedState);
      const state = useStored ? stored : passedState;
      const transcript = useStored ? c.transcript : passedTranscript;
      const [row] = await tx
        .select({ e: routineEntries, r: routines, person: staff })
        .from(routineEntries)
        .innerJoin(routines, eq(routines.id, routineEntries.routineId))
        .innerJoin(staff, eq(staff.id, routineEntries.staffId))
        .where(eq(routineEntries.id, c.checkinId))
        // The day's count adds to what is there; a count added by hand at the same moment waits, then adds up.
        .for('update', { of: routineEntries });
      if (!row?.r.collect) return;
      const { e, r, person } = row;
      const labels = { listLabel: lowerFirst(row.r.collect.listLabel), itemLabel: row.r.collect.itemLabel };
      const took = state.saved.length + state.differences > 0;
      const reported = how === 'ended' || (how === 'dropped' && took);
      const outcome = how === 'call_back' ? 'call_back' : reported ? 'reported' : 'unclear';
      const summary =
        how === 'call_back'
          ? `${person.name.split(' ')[0]} asked to be called back.${took ? ` ${collectSummary(state, labels)}.` : ''}`
          : reported
            ? collectSummary(state, labels)
            : 'The call ended before any item was taken down.';
      await tx
        .update(calls)
        .set({ status: 'completed', endedAt: new Date(), transcript, outcome, summary, extracted: { ...c.extracted, collect: state } })
        .where(eq(calls.id, callId));
      const values = { items: Number(e.values.items ?? 0) + state.saved.length, differences: Number(e.values.differences ?? 0) + state.differences };
      await tx
        .update(routineEntries)
        .set({ values, ...(reported && { status: 'reported' as const, source: 'call' as const }), updatedAt: new Date() })
        .where(eq(routineEntries.id, e.id));
      await this.audit.append(tx, tenantId, { type: 'call.completed', actor: SYSTEM, refId: callId, payload: { staffName: person.name, stage: 'collect', outcome, summary } });
      if (reported) {
        await this.audit.append(tx, tenantId, { type: 'checkin.reported', actor: SYSTEM, refId: r.id, payload: { name: r.name, staffName: person.name, source: 'call', flags: 0 } });
      }
    });
  }

  suggestions(ctx: CollectContext): string[] {
    return collectSuggestions(ctx);
  }

  private async register(tx: Tx, r: RoutineRow): Promise<ResolvedRegister> {
    const ws = await this.records.activeWorkspace(tx);
    const reg = registersOf(normalizeSnapshot(ws.pack)).find((l) => l.id === r.collect?.list);
    if (!reg) throw new Error(`Routine ${r.id}: list ${r.collect?.list} is not in the workspace`);
    return reg;
  }

  /** Items whose title contains the words, most recently changed first. */
  private async lookup(tenantId: string, entityName: string, words: string): Promise<CollectMatch[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.records.activeWorkspace(tx);
      const entity = normalizeSnapshot(ws.pack).entities.find((e) => e.name === entityName);
      const titleField = entity && (entity.title_field ?? entity.fields.find((f) => f.type === 'string')?.name);
      if (!entity || !titleField) return [];
      const rows = await tx
        .select({ id: records.id, data: records.data })
        .from(records)
        .where(
          and(
            eq(records.workspaceId, ws.id),
            eq(records.entity, entity.name),
            sql`position(lower(${words}) in lower(coalesce(${records.data}->>${titleField}, ''))) > 0`,
          ),
        )
        .orderBy(desc(records.updatedAt))
        .limit(4);
      return rows.map((x) => ({ id: x.id, title: titleOf(entity, x.data) }));
    });
  }

  private async save(tenantId: string, callId: string, r: RoutineRow, person: StaffRow, item: Record<string, unknown>): Promise<SaveResult> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.records.activeWorkspace(tx);
      const reg = await this.register(tx, r);
      const now = new Date();
      const data = { ...defaultsFor(r.collect!.defaults, reg.entity, now), ...item };
      try {
        this.records.validate(reg.entity, data);
      } catch (err) {
        return { kind: 'invalid', message: (err as Error).message };
      }
      const dup = reg.checks.find((c): c is Extract<ListCheck, { kind: 'duplicate' }> => c.kind === 'duplicate');
      if (dup && dup.fields.every((f) => data[f.name] !== undefined && data[f.name] !== null && data[f.name] !== '')) {
        const [existing] = await tx
          .select()
          .from(records)
          .where(and(eq(records.workspaceId, ws.id), eq(records.entity, reg.entity.name), ...dup.fields.map((f) => sql`${records.data}->>${f.name} = ${String(data[f.name])}`)))
          .limit(1);
        if (existing) {
          const differ = collectAsk(reg, r.collect!).filter((f) => item[f.name] !== undefined && String(existing.data[f.name] ?? '') !== String(item[f.name]));
          if (differ.length) {
            await this.notes.create(tx, tenantId, {
              recordId: existing.id,
              callId,
              followUp: null,
              kind: 'difference',
              speaker: person.name,
              said: differenceText(person.name, differ, item, now),
              proposed: Object.fromEntries(differ.map((f) => [f.name, item[f.name]])),
            });
          }
          return { kind: 'repeat', id: existing.id, differences: differ.map((f) => f.label) };
        }
      }
      const row = await this.records.create(tx, tenantId, ws, reg.entity.name, data, SYSTEM, { kind: 'call', ref: callId });
      return { kind: 'saved', id: row.id };
    });
  }
}
