import { Global, Injectable, Module } from '@nestjs/common';
import { and, asc, desc, eq, gt, lt } from 'drizzle-orm';
import {
  canonicalJson,
  summarizeEvent,
  type AuditEvent,
  type AuditEventType,
  type AuditVerifyResult,
} from '@onehuman/schemas';
import { sha256 } from '../common/crypto';
import { afterCommit, DbService, type Tx } from '../db/db.service';
import { auditEvents, auditHeads } from '../db/schema';
import { BusService } from '../events/bus.service';

export interface Actor {
  id: string | null;
  kind: 'human' | 'agent' | 'system';
}

export const SYSTEM: Actor = { id: null, kind: 'system' };

export interface AppendInput {
  type: AuditEventType;
  actor: Actor;
  goalId?: string | null;
  taskId?: string | null;
  refId?: string | null;
  payload?: Record<string, unknown>;
}

function genesisHash(tenantId: string) {
  return sha256(`onehuman:genesis:${tenantId}`);
}

function eventHash(prevHash: string, e: {
  tenantId: string;
  seq: number;
  type: string;
  actorId: string | null;
  actorKind: string;
  goalId: string | null;
  taskId: string | null;
  refId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}): string {
  return sha256(`${prevHash}|${canonicalJson(e)}`);
}

/**
 * Append-only, hash-chained audit log. Each event's hash covers the previous
 * hash, so any edit or deletion breaks the chain and `verify()` finds it.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly db: DbService,
    private readonly bus: BusService,
  ) {}

  async append(tx: Tx, tenantId: string, input: AppendInput): Promise<AuditEvent> {
    // Serialise appends per tenant by locking the chain head.
    await tx.insert(auditHeads).values({ tenantId, seq: 0, hash: genesisHash(tenantId) }).onConflictDoNothing();
    const [head] = await tx.select().from(auditHeads).where(eq(auditHeads.tenantId, tenantId)).for('update');
    const prevHash = head!.hash;
    const seq = head!.seq + 1;
    const createdAt = new Date();
    const payload = JSON.parse(JSON.stringify(input.payload ?? {})) as Record<string, unknown>;
    const body = {
      tenantId,
      seq,
      type: input.type,
      actorId: input.actor.id,
      actorKind: input.actor.kind,
      goalId: input.goalId ?? null,
      taskId: input.taskId ?? null,
      refId: input.refId ?? null,
      payload,
      createdAt: createdAt.toISOString(),
    };
    const hash = eventHash(prevHash, body);
    const [row] = await tx
      .insert(auditEvents)
      .values({ ...body, createdAt, prevHash, hash })
      .returning();
    await tx.update(auditHeads).set({ seq, hash }).where(eq(auditHeads.tenantId, tenantId));

    afterCommit(tx, () =>
      this.bus.publishEvent(tenantId, {
        kind: 'event',
        type: input.type,
        seq,
        goalId: body.goalId,
        taskId: body.taskId,
        refId: body.refId,
        summary: summarizeEvent(input.type, payload),
        at: body.createdAt,
      }),
    );
    return toAuditEvent(row!);
  }

  async list(tenantId: string, opts: { goalId?: string; limit?: number; beforeSeq?: number }): Promise<AuditEvent[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    return this.db.tenant(tenantId, async (tx) => {
      const conditions = [eq(auditEvents.tenantId, tenantId)];
      if (opts.goalId) conditions.push(eq(auditEvents.goalId, opts.goalId));
      if (opts.beforeSeq) conditions.push(lt(auditEvents.seq, opts.beforeSeq));
      const rows = await tx
        .select()
        .from(auditEvents)
        .where(and(...conditions))
        .orderBy(opts.goalId ? asc(auditEvents.seq) : desc(auditEvents.seq))
        .limit(limit);
      return rows.map(toAuditEvent);
    });
  }

  /** Recompute the whole chain and compare it with the stored head. */
  async verify(tenantId: string): Promise<AuditVerifyResult> {
    return this.db.tenant(tenantId, async (tx) => {
      const [head] = await tx.select().from(auditHeads).where(eq(auditHeads.tenantId, tenantId));
      let prevHash = genesisHash(tenantId);
      let expectedSeq = 1;
      let checked = 0;
      let lastSeq = 0;
      for (;;) {
        const batch = await tx
          .select()
          .from(auditEvents)
          .where(and(eq(auditEvents.tenantId, tenantId), gt(auditEvents.seq, lastSeq)))
          .orderBy(asc(auditEvents.seq))
          .limit(1000);
        if (batch.length === 0) break;
        for (const e of batch) {
          const recomputed = eventHash(prevHash, {
            tenantId,
            seq: e.seq,
            type: e.type,
            actorId: e.actorId,
            actorKind: e.actorKind,
            goalId: e.goalId,
            taskId: e.taskId,
            refId: e.refId,
            payload: e.payload,
            createdAt: e.createdAt.toISOString(),
          });
          if (e.seq !== expectedSeq || e.prevHash !== prevHash || e.hash !== recomputed) {
            return { ok: false, checked, headSeq: head?.seq ?? 0, headHash: head?.hash ?? '', firstBrokenSeq: e.seq };
          }
          prevHash = e.hash;
          expectedSeq++;
          checked++;
          lastSeq = e.seq;
        }
      }
      const headOk = !head || (head.seq === checked && head.hash === prevHash);
      return {
        ok: headOk,
        checked,
        headSeq: head?.seq ?? 0,
        headHash: head?.hash ?? prevHash,
        firstBrokenSeq: headOk ? null : checked + 1,
      };
    });
  }
}

function toAuditEvent(e: typeof auditEvents.$inferSelect): AuditEvent {
  return {
    id: e.id,
    seq: e.seq,
    type: e.type,
    actorId: e.actorId,
    actorKind: e.actorKind,
    goalId: e.goalId,
    taskId: e.taskId,
    refId: e.refId,
    payload: e.payload,
    prevHash: e.prevHash,
    hash: e.hash,
    createdAt: e.createdAt.toISOString(),
  };
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
