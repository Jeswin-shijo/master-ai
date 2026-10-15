import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  ItemSource,
  ListCard,
  ListHistoryEntry,
  ListItem,
  ListItemDetail,
  ListNote,
  ListMeta,
  ListPage,
  ListProblem,
  ListsOverview,
  ResolvedPack,
} from '@onehuman/schemas';
import { normalizeSnapshot, registersOf, titleOf, type ResolvedRegister } from '@onehuman/agent-kit';
import type { Session } from '../common/auth';
import { AuditService } from '../audit/audit.service';
import { DbService, type Tx } from '../db/db.service';
import { auditEvents, calls, cases, followUpAttempts, principals, recordNotes, records, staff, toolCalls } from '../db/schema';
import { RecordsService } from '../records/records.service';
import { istDate } from '../voice/time';
import { toCsv } from './csv';
import { csvValue, isUuid, istStamp, problemMessage, shown } from './format';
import { PAGE_SIZE, parseListQuery } from './query';
import { cardSelect, dayExpr, flaggedCte, flagSelect, orderSql, totalsSelect, whereSql, type SqlClock } from './sql';

type RecordRow = typeof records.$inferSelect;
type FlagRow = { id: string } & Record<string, unknown>;
type CardRow = { count: number; sum: string | null; problems: number; not_checked: number; new_notes: number };
type Workspace = { id: string; pack: ResolvedPack };
type Change = { field: string; from: unknown; to: unknown };
const EXPORT_LIMIT = 10_000;

const human = (s: Session) => ({ id: s.principalId, kind: 'human' as const });

const unique = <T>(xs: (T | null | undefined)[]): T[] => [...new Set(xs.filter((x): x is T => x !== null && x !== undefined))];

/**
 * The head's lists: each organization type's registers over its records. Checks
 * are compiled to SQL and worked out when a list is read, so they always match
 * today's date and the current pack. Only people mark items checked.
 */
@Injectable()
export class ListsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly records: RecordsService,
  ) {}

  async overview(tenantId: string): Promise<ListsOverview> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const clock = this.clock();
      const lists = [];
      for (const reg of registersOf(ws.pack)) {
        const [row] = (await tx.execute<CardRow>(sql`${flaggedCte(reg, ws.id, clock)} ${cardSelect(reg, clock)}`)).rows;
        lists.push({ ...meta(reg), card: card(reg, row!) });
      }
      const [samples] = await tx.select({ n: count() }).from(records).where(and(eq(records.workspaceId, ws.id), eq(records.source, 'sample')));
      return { lists, samples: samples?.n ?? 0 };
    });
  }

  async page(tenantId: string, listId: string, raw: Record<string, unknown>): Promise<ListPage> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = this.register(ws.pack, listId);
      const clock = this.clock();
      const q = parseListQuery(raw, reg, clock.today);
      const cte = flaggedCte(reg, ws.id, clock);
      const where = whereSql(reg, q);
      const flags = (
        await tx.execute<FlagRow>(sql`${cte} select ${flagSelect(reg)} from flagged r where ${where} order by ${orderSql(q.sort)} limit ${PAGE_SIZE} offset ${(q.page - 1) * PAGE_SIZE}`)
      ).rows;
      const [t] = (await tx.execute<Record<string, unknown>>(sql`${cte} ${totalsSelect(reg, where)}`)).rows;
      let undated = 0;
      if (q.dates && reg.dateField) {
        const [u] = (await tx.execute<{ n: number }>(sql`${cte} select count(*)::int as n from flagged r where ${whereSql(reg, { ...q, dates: null })} and ${dayExpr(reg.dateField)} is null`)).rows;
        undated = Number(u?.n ?? 0);
      }
      return {
        list: meta(reg),
        items: await this.decorate(tx, ws, reg, flags, clock),
        total: Number(t?.total ?? 0),
        totals: Object.fromEntries(reg.totals.map((f, i) => [f.name, Number(t?.[`t${i}`] ?? 0)])),
        undated,
        page: q.page,
        pageSize: PAGE_SIZE,
      };
    });
  }

  async item(tenantId: string, listId: string, itemId: string, viewer: Session['role'] | null = null): Promise<ListItemDetail> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = this.register(ws.pack, listId);
      return { list: meta(reg), item: await this.one(tx, ws, reg, itemId), history: await this.history(tx, ws, reg, itemId), notes: await this.itemNotes(tx, ws, reg, itemId, viewer) };
    });
  }

  async exportCsv(tenantId: string, listId: string, raw: Record<string, unknown>): Promise<string> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = this.register(ws.pack, listId);
      const clock = this.clock();
      const q = parseListQuery(raw, reg, clock.today);
      const flags = (
        await tx.execute<FlagRow>(sql`${flaggedCte(reg, ws.id, clock)} select ${flagSelect(reg)} from flagged r where ${whereSql(reg, q)} order by ${orderSql(q.sort)} limit ${EXPORT_LIMIT}`)
      ).rows;
      const items = await this.decorate(tx, ws, reg, flags, clock);
      const fields = reg.entity.fields;
      return toCsv([
        [...fields.map((f) => f.label), 'Came in', 'Checked by', 'Checked on', 'Problems'],
        ...items.map((it) => [
          ...fields.map((f) => csvValue(f, it.data[f.name], it.titles[f.name])),
          it.source.label,
          it.checked?.by ?? '',
          it.checked ? (istStamp(it.checked.at) ?? '') : '',
          it.problems.map((p) => (p.acknowledged ? `${p.message} (seen)` : p.message)).join('; '),
        ]),
      ]);
    });
  }

  /** An item an owner or admin types in; they have checked it. */
  async create(session: Session, listId: string, data: Record<string, unknown>): Promise<ListItem> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = this.register(ws.pack, listId);
      const row = await this.records.create(tx, session.tenantId, ws, reg.entity.name, data, human(session), { kind: 'manual', checkedBy: session.principalId });
      return this.one(tx, ws, reg, row.id);
    });
  }

  /** A correction by an owner or admin: audited with the old and new values, and checked by them. */
  async update(session: Session, listId: string, itemId: string, input: { data: Record<string, unknown>; note?: string }): Promise<ListItem> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = this.register(ws.pack, listId);
      await this.one(tx, ws, reg, itemId);
      await this.records.update(tx, session.tenantId, ws, reg.entity.name, itemId, input.data, {
        actor: human(session),
        via: 'manual',
        note: input.note ?? null,
        checkedBy: session.principalId,
      });
      return this.one(tx, ws, reg, itemId);
    });
  }

  /** Marks an item checked. With open problems it needs a note saying why it's right; those problems are then accepted. */
  async check(session: Session, listId: string, itemId: string, input: { note?: string }): Promise<ListItem> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = this.register(ws.pack, listId);
      const item = await this.one(tx, ws, reg, itemId);
      const note = input.note?.trim() || null;
      if (item.problems.some((p) => !p.acknowledged) && !note) {
        throw new BadRequestException('This item has problems. Add a note saying why it is right as it is.');
      }
      await this.markChecked(tx, session, reg, item, note);
      return this.one(tx, ws, reg, itemId);
    });
  }

  /** Checks the given items that have no open problem; the rest are skipped. Ids from elsewhere are ignored. */
  async checkMany(session: Session, listId: string, ids: string[]): Promise<{ checked: number; skipped: number }> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = this.register(ws.pack, listId);
      const clock = this.clock();
      const wanted = ids.filter(isUuid);
      if (!wanted.length) return { checked: 0, skipped: 0 };
      const flags = (
        await tx.execute<FlagRow>(
          sql`${flaggedCte(reg, ws.id, clock)} select ${flagSelect(reg)} from flagged r where r.id in (${sql.join(wanted.map((id) => sql`${id}::uuid`), sql`, `)})`,
        )
      ).rows;
      let checked = 0;
      let skipped = 0;
      for (const item of await this.decorate(tx, ws, reg, flags, clock)) {
        if (item.problems.some((p) => !p.acknowledged)) {
          skipped++;
          continue;
        }
        checked++;
        if (!item.checked) await this.markChecked(tx, session, reg, item, null);
      }
      return { checked, skipped };
    });
  }

  /** Removes a wrong or duplicate item. The audit trail keeps a full copy and the reason. */
  async remove(session: Session, listId: string, itemId: string, input: { reason: string }): Promise<{ removed: true }> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const reg = this.register(ws.pack, listId);
      if (!isUuid(itemId)) throw new NotFoundException('Item not found');
      const [row] = await tx
        .delete(records)
        .where(and(eq(records.id, itemId), eq(records.workspaceId, ws.id), eq(records.entity, reg.entity.name)))
        .returning();
      if (!row) throw new NotFoundException('Item not found');
      await this.audit.append(tx, session.tenantId, {
        type: 'record.removed',
        actor: human(session),
        refId: itemId,
        payload: { entity: reg.entity.name, label: reg.entity.label, title: titleOf(reg.entity, row.data), reason: input.reason, data: row.data },
      });
      return { removed: true };
    });
  }

  /** Deletes every sample item, once the company is using real data. */
  async removeSamples(session: Session): Promise<{ removed: number }> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.workspace(tx);
      const gone = await tx
        .delete(records)
        .where(and(eq(records.workspaceId, ws.id), eq(records.source, 'sample')))
        .returning({ id: records.id });
      if (gone.length) {
        await this.audit.append(tx, session.tenantId, { type: 'record.samples_removed', actor: human(session), refId: ws.id, payload: { count: gone.length } });
      }
      return { removed: gone.length };
    });
  }

  private async markChecked(tx: Tx, session: Session, reg: ResolvedRegister, item: ListItem, note: string | null) {
    const accepted = item.problems.map((p) => p.key);
    await tx
      .update(records)
      .set({ checkedBy: session.principalId, checkedAt: new Date(), checkNote: note, checkedProblems: accepted })
      .where(eq(records.id, item.id));
    await this.audit.append(tx, session.tenantId, {
      type: 'record.checked',
      actor: human(session),
      refId: item.id,
      payload: { entity: reg.entity.name, label: reg.entity.label, title: item.title, accepted, ...(note && { note }) },
    });
  }

  private async workspace(tx: Tx): Promise<Workspace> {
    const ws = await this.records.activeWorkspace(tx);
    return { id: ws.id, pack: normalizeSnapshot(ws.pack) };
  }

  private register(pack: ResolvedPack, id: string): ResolvedRegister {
    const reg = registersOf(pack).find((r) => r.id === id);
    if (!reg) throw new NotFoundException('List not found');
    return reg;
  }

  private clock(): SqlClock {
    const now = new Date();
    return { now, today: istDate(now) };
  }

  /** One item with its problems, or 404. */
  private async one(tx: Tx, ws: Workspace, reg: ResolvedRegister, id: string): Promise<ListItem> {
    if (!isUuid(id)) throw new NotFoundException('Item not found');
    const clock = this.clock();
    const flags = (await tx.execute<FlagRow>(sql`${flaggedCte(reg, ws.id, clock)} select ${flagSelect(reg)} from flagged r where r.id = ${id}::uuid`)).rows;
    const [item] = await this.decorate(tx, ws, reg, flags, clock);
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }

  /** Flag rows (in order) → items: names instead of ids, titles for references, problems in words. */
  private async decorate(tx: Tx, ws: Workspace, reg: ResolvedRegister, flags: FlagRow[], clock: SqlClock): Promise<ListItem[]> {
    if (!flags.length) return [];
    const rows = await tx.select().from(records).where(inArray(records.id, flags.map((f) => f.id)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const names = await this.names(tx, rows.flatMap((r) => [r.createdBy, r.updatedBy, r.checkedBy]));
    const agentRefs = unique(rows.filter((r) => r.source === 'agent').map((r) => r.sourceRef));
    const caseOf = new Map(
      agentRefs.length
        ? (
            await tx
              .select({ ref: toolCalls.id, caseId: cases.id, code: cases.code })
              .from(toolCalls)
              .innerJoin(cases, eq(cases.goalId, toolCalls.goalId))
              .where(inArray(toolCalls.id, agentRefs))
          ).map((c) => [c.ref, c] as const)
        : [],
    );
    const refFields = reg.entity.fields.filter((f) => f.type === 'reference');
    const titles = await this.titles(tx, ws.pack, rows.flatMap((r) => refFields.map((f) => r.data[f.name])));
    const callNames = await this.callNames(
      tx,
      unique(rows.flatMap((r) => [r.source === 'call' ? r.sourceRef : null, r.updatedVia === 'call' ? r.updatedRef : null])),
    );
    const newNotes = await this.newNoteCounts(tx, rows.map((r) => r.id));
    const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    return flags.flatMap((flag) => {
      const r = byId.get(flag.id);
      if (!r) return [];
      return [
        {
          id: r.id,
          title: titleOf(reg.entity, r.data),
          data: r.data,
          titles: Object.fromEntries(
            refFields.flatMap((f) => {
              const v = r.data[f.name];
              return typeof v === 'string' && titles.has(v) ? [[f.name, titles.get(v)!]] : [];
            }),
          ),
          source: sourceOf(r, name(r.createdBy), r.sourceRef ? caseOf.get(r.sourceRef) : undefined, r.sourceRef ? callNames.get(r.sourceRef) : undefined),
          updated: { via: r.updatedVia, by: r.updatedVia === 'call' ? (r.updatedRef ? (callNames.get(r.updatedRef) ?? null) : null) : name(r.updatedBy), at: r.updatedAt.toISOString() },
          problems: problemsOf(reg, flag, r, clock.today),
          checked: r.checkedAt ? { by: name(r.checkedBy) ?? 'Someone', at: r.checkedAt.toISOString(), note: r.checkNote } : null,
          newNotes: newNotes.get(r.id) ?? 0,
          createdAt: r.createdAt.toISOString(),
        },
      ];
    });
  }

  private async names(tx: Tx, ids: (string | null)[]): Promise<Map<string, string>> {
    const want = unique(ids);
    if (!want.length) return new Map();
    const rows = await tx.select({ id: principals.id, name: principals.displayName }).from(principals).where(inArray(principals.id, want));
    return new Map(rows.map((p) => [p.id, p.name]));
  }

  /** Titles of the items these values point at, by id. */
  private async titles(tx: Tx, pack: ResolvedPack, values: unknown[]): Promise<Map<string, string>> {
    const ids = unique(values.filter(isUuid));
    if (!ids.length) return new Map();
    const rows = await tx.select({ id: records.id, entity: records.entity, data: records.data }).from(records).where(inArray(records.id, ids));
    return new Map(
      rows.map((t) => {
        const def = pack.entities.find((e) => e.name === t.entity);
        return [t.id, def ? titleOf(def, t.data) : t.entity] as const;
      }),
    );
  }

  /** Who each call was with: the team member, or the outside party. */
  private async callNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
    const want = ids.filter(isUuid);
    if (!want.length) return new Map();
    const rows = await tx
      .select({ id: calls.id, person: staff.name, contact: calls.contactName })
      .from(calls)
      .leftJoin(staff, eq(staff.id, calls.staffId))
      .where(inArray(calls.id, want));
    return new Map(rows.flatMap((c) => (c.person ?? c.contact ? [[c.id, (c.person ?? c.contact)!] as const] : [])));
  }

  private async newNoteCounts(tx: Tx, ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await tx
      .select({ id: recordNotes.recordId, n: count() })
      .from(recordNotes)
      .where(and(inArray(recordNotes.recordId, ids), eq(recordNotes.status, 'new')))
      .groupBy(recordNotes.recordId);
    return new Map(rows.map((r) => [r.id, Number(r.n)]));
  }

  /** An item's notes from calls, newest first, with what they propose in words. */
  private async itemNotes(tx: Tx, ws: Workspace, reg: ResolvedRegister, itemId: string, viewer: Session['role'] | null): Promise<ListNote[]> {
    const rows = await tx.select().from(recordNotes).where(eq(recordNotes.recordId, itemId)).orderBy(desc(recordNotes.createdAt));
    const names = await this.names(tx, rows.map((n) => n.decidedBy));
    const titles = await this.titles(tx, ws.pack, rows.flatMap((n) => Object.values(n.proposed)));
    // Call again: only a stopped follow-up, and only for who may start it: the owner for a party, a manager for a team member.
    const stopped = new Set((await tx.select({ key: followUpAttempts.followUp }).from(followUpAttempts).where(and(eq(followUpAttempts.recordId, itemId), eq(followUpAttempts.state, 'stopped')))).map((x) => x.key));
    const mayRestart = (key: string | null) => {
      const f = reg.followUps.find((x) => x.key === key);
      return !!f && (f.who === 'party' ? viewer === 'owner' : viewer === 'owner' || viewer === 'admin');
    };
    return rows.map((n) => ({
      canCallAgain: (n.kind === 'unreachable' || n.kind === 'wrong_number') && !!n.followUp && stopped.has(n.followUp) && mayRestart(n.followUp),
      id: n.id,
      kind: n.kind,
      speaker: n.speaker,
      said: n.said,
      // jsonb does not keep key order: show the fields in the list's own order.
      proposed: Object.entries(n.proposed)
        .sort(([x], [y]) => fieldIndex(reg, x) - fieldIndex(reg, y))
        .map(([field, value]) => {
          const f = reg.entity.fields.find((x) => x.name === field);
          return { field, label: f?.label ?? field, value: f ? shown(f, value, titles) : String(value) };
        }),
      promiseOn: n.promiseOn,
      status: n.status,
      decidedBy: n.decidedBy ? (names.get(n.decidedBy) ?? 'Someone') : null,
      callId: n.callId,
      at: n.createdAt.toISOString(),
    }));
  }

  /** The item's history from the audit trail, in words, references by title. */
  private async history(tx: Tx, ws: Workspace, reg: ResolvedRegister, itemId: string): Promise<ListHistoryEntry[]> {
    const events = await tx
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.refId, itemId), inArray(auditEvents.type, ['record.created', 'record.updated', 'record.checked'])))
      .orderBy(asc(auditEvents.seq));
    const names = await this.names(tx, events.filter((e) => e.actorKind === 'human').map((e) => e.actorId));
    const refNames = new Set(reg.entity.fields.filter((f) => f.type === 'reference').map((f) => f.name));
    const changes = events.flatMap((e) => (e.payload as { changes?: Change[] }).changes ?? []);
    const titles = await this.titles(tx, ws.pack, changes.filter((c) => refNames.has(c.field)).flatMap((c) => [c.from, c.to]));
    return events.map((e) => {
      const p = e.payload as { changes?: Change[]; note?: string };
      return {
        at: e.createdAt.toISOString(),
        kind: e.type.slice('record.'.length) as ListHistoryEntry['kind'],
        who: e.actorKind === 'agent' ? 'AI agent' : e.actorKind === 'system' ? 'ONEHUMAN OS' : (names.get(e.actorId ?? '') ?? 'Someone'),
        changes: (p.changes ?? []).map((c) => {
          const field = reg.entity.fields.find((f) => f.name === c.field);
          return {
            field: c.field,
            label: field?.label ?? c.field,
            from: field ? shown(field, c.from, titles) : String(c.from ?? '—'),
            to: field ? shown(field, c.to, titles) : String(c.to ?? '—'),
          };
        }),
        note: p.note ?? null,
      };
    });
  }
}

function meta(reg: ResolvedRegister): ListMeta {
  return {
    id: reg.id,
    label: reg.label,
    main: reg.main,
    explicit: reg.explicit,
    entity: reg.entity,
    columns: reg.columns.map((f) => f.name),
    filters: reg.filters.map((f) => f.name),
    dateField: reg.dateField?.name ?? null,
    totals: reg.totals.map((f) => f.name),
    sort: { field: reg.sort.field?.name ?? null, dir: reg.sort.dir },
  };
}

function card(reg: ResolvedRegister, row: CardRow): ListCard {
  return {
    count: Number(row.count ?? 0),
    countLabel: reg.card?.count?.label ?? (reg.dateField ? 'this month' : 'in all'),
    sum: reg.card?.sum ? Number(row.sum ?? 0) : null,
    sumField: reg.card?.sum?.field ?? null,
    sumLabel: reg.card?.sum?.label ?? null,
    problems: Number(row.problems ?? 0),
    notChecked: Number(row.not_checked ?? 0),
    newNotes: Number(row.new_notes ?? 0),
  };
}

function sourceOf(r: RecordRow, creator: string | null, c?: { caseId: string; code: string }, callWith?: string): ItemSource {
  switch (r.source) {
    case 'sample':
      return { kind: 'sample', label: 'Sample data' };
    case 'agent':
      return c ? { kind: 'agent', label: `AI agent (${c.code})`, caseId: c.caseId, caseCode: c.code } : { kind: 'agent', label: 'AI agent' };
    case 'call':
      return { kind: 'call', label: callWith ? `Call with ${callWith}` : 'Phone call', ...(r.sourceRef ? { callId: r.sourceRef } : {}) };
    default:
      return { kind: 'manual', label: creator ? `${creator}, by hand` : 'By hand' };
  }
}

function problemsOf(reg: ResolvedRegister, flag: FlagRow, r: RecordRow, today: string): ListProblem[] {
  return reg.checks.flatMap((c, i) => {
    if (flag[`p${i}`] !== true) return [];
    const problem: ListProblem = { key: c.key, message: problemMessage(c, r.data, today, reg.entity), acknowledged: r.checkedProblems.includes(c.key) };
    if (c.kind === 'duplicate') {
      const min = flag[`d${i}_min`] as string;
      problem.relatedId = min !== r.id ? min : (flag[`d${i}_max`] as string);
    }
    return [problem];
  });
}

const fieldIndex = (reg: ResolvedRegister, name: string) => {
  const i = reg.entity.fields.findIndex((f) => f.name === name);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};
