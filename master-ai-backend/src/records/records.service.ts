import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { EntityDef, OutboxItem, PackRecord, ResolvedPack } from '@onehuman/schemas';
import { entityValidator } from '@onehuman/agent-kit';
import { AuditService, type Actor } from '../audit/audit.service';
import { DbService, type Tx } from '../db/db.service';
import { outbox, records, workspaces } from '../db/schema';

export type RecordFilter = Record<string, string | number | boolean>;

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

  async create(tx: Tx, tenantId: string, ws: { id: string; pack: ResolvedPack }, entityName: string, data: Record<string, unknown>, actor: Actor) {
    const entity = this.entityOf(ws.pack, entityName);
    const clean = this.validate(entity, data);
    const [row] = await tx
      .insert(records)
      .values({ tenantId, workspaceId: ws.id, entity: entity.name, data: clean, createdBy: actor.id })
      .returning();
    await this.audit.append(tx, tenantId, {
      type: 'record.created',
      actor,
      refId: row!.id,
      payload: { entity: entity.name, title: entity.title_field ? clean[entity.title_field] : undefined },
    });
    return row!;
  }

  async update(tx: Tx, ws: { id: string; pack: ResolvedPack }, entityName: string, id: string, patch: Record<string, unknown>) {
    const entity = this.entityOf(ws.pack, entityName);
    const [current] = await tx
      .select()
      .from(records)
      .where(and(eq(records.id, id), eq(records.workspaceId, ws.id), eq(records.entity, entity.name)));
    if (!current) throw new NotFoundException(`${entity.name} ${id} not found`);
    const merged = this.validate(entity, { ...current.data, ...patch });
    const [row] = await tx.update(records).set({ data: merged, updatedAt: new Date() }).where(eq(records.id, id)).returning();
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

  async createFromApi(tenantId: string, principalId: string, entityName: string, data: Record<string, unknown>): Promise<PackRecord> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.activeWorkspace(tx);
      return toRecord(await this.create(tx, tenantId, ws, entityName, data, { id: principalId, kind: 'human' }));
    });
  }

  async outbox(tenantId: string): Promise<OutboxItem[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const rows = await tx.select().from(outbox).orderBy(desc(outbox.createdAt)).limit(100);
      return rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, payload: r.payload, createdAt: r.createdAt.toISOString() }));
    });
  }

  /** A few realistic records per entity so a new tenant can try the agents straight away. */
  async seedSamples(tx: Tx, tenantId: string, ws: { id: string; pack: ResolvedPack }, actor: Actor) {
    for (const entity of ws.pack.entities) {
      for (let i = 0; i < 3; i++) {
        await this.create(tx, tenantId, ws, entity.name, sampleRecord(entity, i), actor);
      }
    }
  }
}

export function toRecord(r: typeof records.$inferSelect): PackRecord {
  return { id: r.id, entity: r.entity, data: r.data, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
}

const NAMES = ['Asha Menon', 'Rahul Nair', 'Priya Sharma', 'Arjun Iyer', 'Fatima Khan', 'Vikram Rao'];
const CITIES = ['Kochi', 'Bengaluru', 'Mumbai', 'Chennai', 'Pune', 'Jaipur'];
const PLACES = ['Munnar', 'Goa', 'Jaipur', 'Coorg', 'Rishikesh', 'Andaman'];

function sampleRecord(entity: EntityDef, i: number): Record<string, unknown> {
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
