import { Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import type { CallRecord } from '@onehuman/schemas';
import { FollowUpCallsService } from '../follow-ups/follow-up-calls.service';
import { DbService } from '../db/db.service';
import { calls, delegations, routineEntries, routines, staff } from '../db/schema';
import { RoutinesService } from '../routines/routines.service';
import { toCall } from './call-record';
import { DelegationService } from './delegation.service';

/**
 * Every call, whatever it is about: delegated work, a routine check-in or
 * collection, or a follow-up on a list item. The simulator and the telephony webhooks
 * talk to this one service; it hands each turn to the right conversation.
 */
@Injectable()
export class CallsService {
  constructor(
    private readonly db: DbService,
    private readonly delegations: DelegationService,
    private readonly routines: RoutinesService,
    private readonly followUps: FollowUpCallsService,
  ) {}

  /** Calls ringing or in progress, for the web phone simulator and the live call card. */
  active(tenantId: string): Promise<CallRecord[]> {
    return this.list(tenantId, { statuses: ['ringing', 'in_progress'] });
  }

  async list(tenantId: string, opts: { statuses?: CallRecord['status'][]; limit?: number } = {}): Promise<CallRecord[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ c: calls, person: staff, job: delegations.title, routine: routines.name })
        .from(calls)
        .leftJoin(staff, eq(staff.id, calls.staffId))
        .leftJoin(delegations, eq(delegations.id, calls.delegationId))
        .leftJoin(routineEntries, eq(routineEntries.id, calls.checkinId))
        .leftJoin(routines, eq(routines.id, routineEntries.routineId))
        .where(opts.statuses ? inArray(calls.status, opts.statuses) : undefined)
        .orderBy(desc(calls.createdAt))
        .limit(opts.limit ?? 100);
      return Promise.all(
        rows.map(async (r) => toCall(r.c, r.person, r.job ?? r.routine ?? r.c.extracted.about?.title ?? 'Call', r.c.followUp ? await this.followUps.suggestionsFor(tx, r.c) : await this.routines.suggestionsFor(tx, r.c, r.person))),
      );
    });
  }

  async get(tenantId: string, callId: string): Promise<CallRecord> {
    const rows = await this.db.tenant(tenantId, async (tx) => {
      const [r] = await tx
        .select({ c: calls, person: staff, job: delegations.title, routine: routines.name })
        .from(calls)
        .leftJoin(staff, eq(staff.id, calls.staffId))
        .leftJoin(delegations, eq(delegations.id, calls.delegationId))
        .leftJoin(routineEntries, eq(routineEntries.id, calls.checkinId))
        .leftJoin(routines, eq(routines.id, routineEntries.routineId))
        .where(eq(calls.id, callId));
      return r ? toCall(r.c, r.person, r.job ?? r.routine ?? r.c.extracted.about?.title ?? 'Call', r.c.followUp ? await this.followUps.suggestionsFor(tx, r.c) : await this.routines.suggestionsFor(tx, r.c, r.person)) : null;
    });
    if (!rows) throw new NotFoundException('Call not found');
    return rows;
  }

  /** The raw call row, for provider webhooks to check the provider's call id and state. */
  async raw(tenantId: string, callId: string) {
    const [c] = await this.db.tenant(tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, callId)));
    return c ?? null;
  }

  async answer(tenantId: string, callId: string): Promise<CallRecord> {
    const c = await this.must(tenantId, callId);
    if (c.followUp) await this.followUps.answer(tenantId, c);
    else if (c.checkinId) await this.routines.answer(tenantId, c);
    else await this.delegations.answer(tenantId, callId);
    return this.get(tenantId, callId);
  }

  async reply(tenantId: string, callId: string, text: string): Promise<CallRecord> {
    const c = await this.must(tenantId, callId);
    if (c.followUp) await this.followUps.reply(tenantId, c, text);
    else if (c.checkinId) await this.routines.reply(tenantId, c, text);
    else await this.delegations.reply(tenantId, callId, text);
    return this.get(tenantId, callId);
  }

  /** Rejected, rang out or hung up. */
  async decline(tenantId: string, callId: string): Promise<CallRecord> {
    const c = await this.must(tenantId, callId);
    if (c.followUp) await this.followUps.decline(tenantId, c);
    else if (c.checkinId) await this.routines.decline(tenantId, c);
    else await this.delegations.decline(tenantId, callId);
    return this.get(tenantId, callId);
  }

  private async must(tenantId: string, callId: string) {
    const c = await this.raw(tenantId, callId);
    if (!c) throw new NotFoundException('Call not found');
    return c;
  }
}
