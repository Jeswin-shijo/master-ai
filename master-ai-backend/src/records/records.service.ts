import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { EntityDef, HumanRole, OutboxItem, PackRecord, ResolvedPack } from '@onehuman/schemas';
import { entityValidator, titleOf } from '@onehuman/agent-kit';
import { AuditService, type Actor } from '../audit/audit.service';
import { DbService, type Tx } from '../db/db.service';
import { outbox, records, workspaces } from '../db/schema';

export type RecordFilter = Record<string, string | number | boolean>;

export type RecordSourceKind = 'manual' | 'call' | 'agent' | 'sample';

/** How an item comes in. An owner or admin who adds it has checked it. */
export interface RecordSource {
  kind: RecordSourceKind;
  /** The call or tool call that added it. */
  ref?: string | null;
  checkedBy?: string | null;
}

/** Who changes an item and how. An owner or admin who changes it has checked it; anyone else's change clears the check. */
export interface RecordChange {
  actor: Actor;
  via: 'manual' | 'call' | 'agent' | 'system';
  ref?: string | null;
  note?: string | null;
  checkedBy?: string | null;
}

/** Pack records: sector entities stored as JSONB, validated by the pack's schema. */
@Injectable()
export class RecordsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async activeWorkspace(tx: Tx, workspaceId?: string) {
    const rows = await tx
      .select()
      .from(workspaces)
      .where(workspaceId ? eq(workspaces.id, workspaceId) : undefined)
      .orderBy(desc(workspaces.createdAt))
      .limit(1);
    const ws = rows[0];
    if (!ws) throw new NotFoundException('No workspace yet. Install an Industry Pack first.');
    return ws;
  }

  entityOf(pack: ResolvedPack, name: string): EntityDef {
    const entity = pack.entities.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (!entity) {
      throw new BadRequestException(`Unknown entity "${name}". Known: ${pack.entities.map((e) => e.name).join(', ')}`);
    }
    return entity;
  }

  validate(entity: EntityDef, data: Record<string, unknown>): Record<string, unknown> {
    const result = entityValidator(entity).safeParse(data);
    if (!result.success) {
      throw new BadRequestException(result.error.issues.map((i) => `${entity.name}.${i.path.join('.')}: ${i.message}`));
    }
    return result.data as Record<string, unknown>;
  }

  async search(tx: Tx, workspaceId: string, entity: string, opts: { query?: string; filter?: RecordFilter; limit?: number }) {
    const conditions = [eq(records.workspaceId, workspaceId), eq(records.entity, entity)];
    if (opts.query) conditions.push(sql`${records.data}::text ilike ${`%${opts.query}%`}`);
    for (const [field, value] of Object.entries(opts.filter ?? {})) {
      conditions.push(sql`${records.data}->>${field} = ${String(value)}`);
    }
    return tx
      .select()
      .from(records)
      .where(and(...conditions))
      .orderBy(desc(records.updatedAt))
      .limit(Math.min(opts.limit ?? 25, 100));
  }

  async create(
    tx: Tx,
    tenantId: string,
    ws: { id: string; pack: ResolvedPack },
    entityName: string,
    data: Record<string, unknown>,
    actor: Actor,
    source: RecordSource = { kind: 'manual' },
  ) {
    const entity = this.entityOf(ws.pack, entityName);
    const clean = this.validate(entity, data);
    const [row] = await tx
      .insert(records)
      .values({
        tenantId,
        workspaceId: ws.id,
        entity: entity.name,
        data: clean,
        createdBy: actor.id,
        source: source.kind,
        sourceRef: source.ref ?? null,
        ...(source.checkedBy && { checkedBy: source.checkedBy, checkedAt: new Date() }),
      })
      .returning();
    await this.audit.append(tx, tenantId, {
      type: 'record.created',
      actor,
      refId: row!.id,
      payload: { entity: entity.name, label: entity.label, title: titleOf(entity, clean), source: source.kind },
    });
    return row!;
  }

  async update(
    tx: Tx,
    tenantId: string,
    ws: { id: string; pack: ResolvedPack },
    entityName: string,
    id: string,
    patch: Record<string, unknown>,
    change: RecordChange,
  ) {
    const entity = this.entityOf(ws.pack, entityName);
    const [current] = await tx
      .select()
      .from(records)
      .where(and(eq(records.id, id), eq(records.workspaceId, ws.id), eq(records.entity, entity.name)))
      .for('update');
    if (!current) throw new NotFoundException(`${entity.label} not found`);
    const merged = this.validate(entity, { ...current.data, ...patch });
    const changes = changedFields(entity, current.data, merged);
    if (changes.length === 0) return current;
    const [row] = await tx
      .update(records)
      .set({
        data: merged,
        updatedAt: new Date(),
        updatedBy: change.actor.kind === 'human' ? change.actor.id : null,
        updatedVia: change.via,
        updatedRef: change.ref ?? null,
        checkedBy: change.checkedBy ?? null,
        checkedAt: change.checkedBy ? new Date() : null,
        checkNote: null,
        checkedProblems: [],
      })
      .where(eq(records.id, id))
      .returning();
    await this.audit.append(tx, tenantId, {
      type: 'record.updated',
      actor: change.actor,
      refId: id,
      payload: { entity: entity.name, label: entity.label, title: titleOf(entity, merged), changes, via: change.via, ...(change.ref && { ref: change.ref }), ...(change.note && { note: change.note }) },
    });
    return row!;
  }

  // ---- HTTP-facing helpers ----

  async list(tenantId: string, entityName: string, query?: string): Promise<PackRecord[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.activeWorkspace(tx);
      const entity = this.entityOf(ws.pack, entityName);
      const rows = await this.search(tx, ws.id, entity.name, { query, limit: 100 });
      return rows.map(toRecord);
    });
  }

  async createFromApi(tenantId: string, principalId: string, role: HumanRole, entityName: string, data: Record<string, unknown>): Promise<PackRecord> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.activeWorkspace(tx);
      const manager = role === 'owner' || role === 'admin';
      const row = await this.create(tx, tenantId, ws, entityName, data, { id: principalId, kind: 'human' }, { kind: 'manual', checkedBy: manager ? principalId : null });
      return toRecord(row);
    });
  }

  async outbox(tenantId: string): Promise<OutboxItem[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const rows = await tx.select().from(outbox).orderBy(desc(outbox.createdAt)).limit(100);
      return rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, payload: r.payload, createdAt: r.createdAt.toISOString() }));
    });
  }

  /** A few realistic items per record type so a new company can try things straight away. References point at sample items. */
  async seedSamples(tx: Tx, tenantId: string, ws: { id: string; pack: ResolvedPack }, actor: Actor) {
    const made = new Map<string, string[]>();
    for (const entity of seedOrder(ws.pack.entities)) {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const ref = (name: string) => made.get(name)?.[i % 3];
        const row = await this.create(tx, tenantId, ws, entity.name, sampleRecord(entity, i, ref), actor, { kind: 'sample' });
        ids.push(row.id);
      }
      made.set(entity.name, ids);
    }
  }
}

export function toRecord(r: typeof records.$inferSelect): PackRecord {
  return { id: r.id, entity: r.entity, data: r.data, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
}

/** Fields whose value differs, with the old and new values (null for none). Blank and missing count as the same. */
export function changedFields(entity: EntityDef, before: Record<string, unknown>, after: Record<string, unknown>) {
  const norm = (v: unknown) => JSON.stringify(v === undefined || v === '' ? null : v);
  return entity.fields
    .filter((f) => norm(before[f.name]) !== norm(after[f.name]))
    .map((f) => ({ field: f.name, from: before[f.name] ?? null, to: after[f.name] ?? null }));
}

/** Record types in an order where each comes after the ones its references point at (a cycle is broken anywhere). */
export function seedOrder(entities: EntityDef[]): EntityDef[] {
  const names = new Set(entities.map((e) => e.name));
  const done = new Set<string>();
  const out: EntityDef[] = [];
  let left = [...entities];
  while (left.length) {
    const ready = left.filter((e) =>
      e.fields.every((f) => f.type !== 'reference' || !f.ref || f.ref === e.name || !names.has(f.ref) || done.has(f.ref)),
    );
    for (const e of ready.length ? ready : [left[0]!]) {
      out.push(e);
      done.add(e.name);
    }
    left = left.filter((e) => !done.has(e.name));
  }
  return out;
}

const NAMES = ['Asha Menon', 'Rahul Nair', 'Priya Sharma', 'Arjun Iyer', 'Fatima Khan', 'Vikram Rao'];
const CITIES = ['Kochi', 'Bengaluru', 'Mumbai', 'Chennai', 'Pune', 'Jaipur'];
const PLACES = ['Munnar', 'Goa', 'Jaipur', 'Coorg', 'Rishikesh', 'Andaman'];

export function sampleRecord(entity: EntityDef, i: number, ref: (entityName: string) => string | undefined = () => undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const name = NAMES[(i + entity.name.length) % NAMES.length]!;
  for (const f of entity.fields) {
    const key = f.name.toLowerCase();
    switch (f.type) {
      case 'email':
        out[f.name] = `${name.split(' ')[0]!.toLowerCase()}@example.com`;
        break;
      case 'phone':
        out[f.name] = `+91 98${String(4000000 + i * 1234567).slice(0, 3)} ${String(10000 + i * 4321).slice(0, 5)}`;
        break;
      case 'money':
        out[f.name] = [4500, 12000, 2500][i % 3];
        break;
      case 'number':
        out[f.name] = key.includes('rating') ? 4 + (i % 2) * 0.5 : 10 + i * 5;
        break;
      case 'integer':
        out[f.name] = key.includes('duration') ? 45 + i * 15 : 2 + i;
        break;
      case 'boolean':
        out[f.name] = i !== 2;
        break;
      case 'date':
        out[f.name] = day(key.includes('follow') ? -i - 1 : 7 + i * 3);
        break;
      case 'datetime':
        out[f.name] = new Date(Date.now() - i * 3_600_000).toISOString();
        break;
      case 'enum':
        out[f.name] = f.options?.[i % f.options.length] ?? null;
        break;
      case 'text':
        out[f.name] = `Sample ${entity.label.toLowerCase()} note ${i + 1}.`;
        break;
      case 'reference':
        out[f.name] = (f.ref && ref(f.ref)) ?? (f.required ? `${entity.label} ${f.label.toLowerCase()} ${i + 1}` : null);
        break;
      default:
        if (key.includes('name') && !key.includes('product')) out[f.name] = name;
        else if (key.includes('city')) out[f.name] = CITIES[i % CITIES.length];
        else if (key.includes('destination')) out[f.name] = PLACES[i % PLACES.length];
        else if (key.includes('time')) out[f.name] = `${10 + i}:00`;
        else out[f.name] = `${entity.label} ${f.label.toLowerCase()} ${i + 1}`;
    }
  }
  return out;
}
