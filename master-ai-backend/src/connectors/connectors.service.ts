import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { ResolvedPack } from '@onehuman/schemas';
import type { ResolvedTool } from '@onehuman/agent-kit';
import type { Actor } from '../audit/audit.service';
import type { Tx } from '../db/db.service';
import { outbox, records } from '../db/schema';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { RecordsService, toRecord, type RecordFilter } from '../records/records.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ExecuteContext {
  tx: Tx;
  tenantId: string;
  workspace: { id: string; pack: ResolvedPack };
  toolCallId: string;
  actor: Actor;
}

/**
 * Connector gateway. Agents only ever see tools, never credentials. Internal
 * primitives (records, knowledge) act directly; outward primitives (messages,
 * payments, refunds, calendar) go to the sandbox connector, which records the
 * exact action in the outbox until a real connector (WhatsApp Business,
 * Razorpay, Google Calendar, an MCP server...) is attached for the tenant.
 */
@Injectable()
export class ConnectorsService {
  constructor(
    private readonly records: RecordsService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async execute(ctx: ExecuteContext, tool: ResolvedTool, args: Record<string, unknown>): Promise<unknown> {
    const { tx, tenantId, workspace } = ctx;
    switch (tool.primitive.name) {
      case 'records.search': {
        const entity = this.records.entityOf(workspace.pack, String(args.entity));
        const rows = await this.records.search(tx, workspace.id, entity.name, {
          query: args.query as string | undefined,
          filter: args.filter as RecordFilter | undefined,
          limit: args.limit as number | undefined,
        });
        return { entity: entity.name, count: rows.length, records: rows.map((r) => ({ id: r.id, ...r.data })) };
      }
      case 'records.get': {
        const entity = this.records.entityOf(workspace.pack, String(args.entity));
        const [row] = await tx
          .select()
          .from(records)
          .where(and(eq(records.id, String(args.id)), eq(records.workspaceId, workspace.id), eq(records.entity, entity.name)));
        if (!row) throw new Error(`${entity.name} ${String(args.id)} not found`);
        return toRecord(row);
      }
      case 'records.create': {
        const row = await this.records.create(tx, tenantId, workspace, String(args.entity), args.data as Record<string, unknown>, ctx.actor, {
          kind: 'agent',
          ref: UUID.test(ctx.toolCallId) ? ctx.toolCallId : null,
        });
        return { created: true, id: row.id, entity: row.entity, data: row.data };
      }
      case 'records.update': {
        const row = await this.records.update(tx, tenantId, workspace, String(args.entity), String(args.id), (args.patch ?? {}) as Record<string, unknown>, {
          actor: ctx.actor,
          via: 'agent',
          ref: UUID.test(ctx.toolCallId) ? ctx.toolCallId : null,
        });
        return { updated: true, id: row.id, entity: row.entity, data: row.data };
      }
      case 'knowledge.search':
        return { results: await this.knowledge.search(tx, String(args.query), args.limit as number | undefined) };
      case 'message.draft':
        return this.toOutbox(ctx, 'message', 'draft', args, 'Draft saved for review. Nothing was sent.');
      case 'message.send':
        return this.toOutbox(ctx, 'message', 'simulated', args, 'No messaging connector is attached yet; the message was recorded in the outbox instead of being sent.');
      case 'payment.request':
        return this.toOutbox(ctx, 'payment_request', 'simulated', args, 'No payments connector is attached yet; the payment request was recorded in the outbox.');
      case 'refund.issue':
        return this.toOutbox(ctx, 'refund', 'simulated', args, 'No payments connector is attached yet; the refund was recorded in the outbox.');
      case 'schedule.create':
        return this.toOutbox(ctx, 'schedule', 'simulated', args, 'No calendar connector is attached yet; the event was recorded in the outbox.');
      case 'document.generate':
        return this.toOutbox(ctx, 'document', 'draft', args, 'Document saved as a draft.');
      default:
        throw new Error(`No connector implements ${tool.primitive.name}`);
    }
  }

  private async toOutbox(
    ctx: ExecuteContext,
    kind: (typeof outbox.$inferInsert)['kind'],
    status: 'draft' | 'simulated',
    payload: Record<string, unknown>,
    note: string,
  ) {
    const [row] = await ctx.tx
      .insert(outbox)
      .values({ tenantId: ctx.tenantId, toolCallId: ctx.toolCallId, kind, status, payload })
      .returning();
    return { outboxId: row!.id, status, note };
  }
}
