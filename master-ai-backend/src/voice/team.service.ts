import { Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import {
  CreateStaffInputSchema,
  UpdateStaffInputSchema,
  type CreateStaffInput,
  type StaffMember,
  type UpdateStaffInput,
} from '@onehuman/schemas';
import type { z } from 'zod';
import { AuditService, type Actor } from '../audit/audit.service';
import { CurrentSession, type Session } from '../common/auth';
import { ZodPipe } from '../common/zod';
import { DbService, type Tx } from '../db/db.service';
import { calls, delegations, staff } from '../db/schema';

/** Words that say little about who should do a job. */
const STOP = new Set('the a an and or of to for in on at by with is be it this that our we my me please make sure get'.split(' '));

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => (w.endsWith('s') && w.length > 4 ? w.slice(0, -1) : w)),
  );
}

/**
 * The team directory: the people in charge whom the AI phones to get work
 * done. Responsibilities decide who gets which job.
 */
@Injectable()
export class TeamService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<StaffMember[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const rows = await tx.select().from(staff).orderBy(asc(staff.createdAt));
      const stats = await tx.execute<{ staff_id: string; calls: number; open: number; done: number }>(sql`
        select s.id as staff_id,
          (select count(*)::int from ${calls} c where c.staff_id = s.id) as calls,
          (select count(*)::int from ${delegations} d where d.staff_id = s.id and d.status in ('assigning','accepted','in_progress')) as open,
          (select count(*)::int from ${delegations} d where d.staff_id = s.id and d.status = 'done') as done
        from ${staff} s
      `);
      const byId = new Map(stats.rows.map((r) => [r.staff_id, r]));
      return rows.map((r) => toStaff(r, byId.get(r.id)));
    });
  }

  async create(session: Session, input: z.output<typeof CreateStaffInputSchema>): Promise<StaffMember> {
    return this.db.tenant(session.tenantId, (tx) => this.insert(tx, session.tenantId, input, { id: session.principalId, kind: 'human' }));
  }

  async update(session: Session, id: string, input: z.output<typeof UpdateStaffInputSchema>): Promise<StaffMember> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const [row] = await tx.update(staff).set(input).where(eq(staff.id, id)).returning();
      if (!row) throw new NotFoundException('Team member not found');
      await this.audit.append(tx, session.tenantId, {
        type: 'staff.updated',
        actor: { id: session.principalId, kind: 'human' },
        refId: id,
        payload: { name: row.name, changes: Object.keys(input) },
      });
      return toStaff(row);
    });
  }

  private async insert(tx: Tx, tenantId: string, input: z.output<typeof CreateStaffInputSchema>, actor: Actor) {
    const [row] = await tx.insert(staff).values({ tenantId, ...input }).returning();
    await this.audit.append(tx, tenantId, {
      type: 'staff.added',
      actor,
      refId: row!.id,
      payload: { name: row!.name, title: row!.title, responsibilities: row!.responsibilities },
    });
    return toStaff(row!);
  }

  /** Active team, for agent prompts and the offline agent. */
  async directory(tx: Tx) {
    return tx.select().from(staff).where(eq(staff.status, 'active')).orderBy(asc(staff.createdAt));
  }

  /**
   * Who should get this job: an exact or partial name match first, then the only
   * person on the team, then the best overlap between the request and each
   * person's title and responsibilities.
   */
  async resolveAssignee(tx: Tx, assignee: string, task: string) {
    const team = await this.directory(tx);
    if (team.length === 0) return null;
    const a = assignee.toLowerCase().trim();
    const byName = team.find((p) => p.name.toLowerCase() === a) ?? team.find((p) => p.name.toLowerCase().split(' ').includes(a.split(' ')[0] ?? ''));
    if (byName) return byName;
    // With one person in charge, they get the job whatever the agent called them.
    if (team.length === 1) return team[0]!;
    const want = words(`${assignee} ${assignee} ${task}`);
    const scored = team
      .map((p) => {
        const have = words(`${p.title} ${p.responsibilities.join(' ')}`);
        let score = 0;
        for (const w of want) if (have.has(w)) score++;
        return { p, score };
      })
      .sort((x, y) => y.score - x.score);
    return scored[0]!.score > 0 ? scored[0]!.p : null;
  }

  /** A small sample team so a new company can try phone delegation straight away. */
  async seedSamples(tx: Tx, tenantId: string, actor: Actor) {
    const samples: z.output<typeof CreateStaffInputSchema>[] = [
      {
        name: 'Ravi Kumar',
        phone: '+91 90000 00001',
        title: 'Operations manager',
        responsibilities: ['operations', 'bookings', 'suppliers', 'hotels', 'inspections', 'vendors', 'schedule'],
        workingHours: { days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '19:00' },
        language: 'en',
      },
      {
        name: 'Meera Joseph',
        phone: '+91 90000 00002',
        title: 'Accounts executive',
        responsibilities: ['accounts', 'payments', 'invoices', 'refunds', 'collections', 'billing', 'gst'],
        workingHours: { days: [1, 2, 3, 4, 5], start: '09:30', end: '18:30' },
        language: 'en',
      },
      {
        name: 'Arun Das',
        phone: '+91 90000 00003',
        title: 'Field coordinator',
        responsibilities: ['field', 'site visits', 'deliveries', 'pickups', 'customers', 'documents', 'drop'],
        workingHours: { days: [1, 2, 3, 4, 5, 6], start: '08:00', end: '20:00' },
        language: 'en',
      },
    ];
    for (const s of samples) await this.insert(tx, tenantId, s, actor);
  }
}

export function toStaff(r: typeof staff.$inferSelect, stats?: { calls: number; open: number; done: number }): StaffMember {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    title: r.title,
    responsibilities: r.responsibilities,
    workingHours: r.workingHours,
    language: r.language,
    status: r.status,
    stats: { calls: stats?.calls ?? 0, openDelegations: stats?.open ?? 0, done: stats?.done ?? 0 },
    createdAt: r.createdAt.toISOString(),
  };
}

@Controller('team')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  list(@CurrentSession() s: Session) {
    return this.team.list(s.tenantId);
  }

  @Post()
  create(@CurrentSession() s: Session, @Body(new ZodPipe(CreateStaffInputSchema)) body: CreateStaffInput) {
    return this.team.create(s, body as z.output<typeof CreateStaffInputSchema>);
  }

  @Patch(':id')
  update(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateStaffInputSchema)) body: UpdateStaffInput) {
    return this.team.update(s, id, body as z.output<typeof UpdateStaffInputSchema>);
  }
}
