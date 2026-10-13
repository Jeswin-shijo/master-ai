import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { approvalSigningMessage, type ApprovalDecisionInput, type ApprovalRequest, type BatchApprovalInput } from '@onehuman/schemas';
import { AuditService } from '../audit/audit.service';
import type { Session } from '../common/auth';
import { verifyEd25519 } from '../common/crypto';
import { toApproval } from '../common/mappers';
import { DbService } from '../db/db.service';
import { agents, approvalRequests, deviceKeys, toolCalls } from '../db/schema';
import { addFeedback } from '../orchestration/context';
import { TemporalService } from '../orchestration/temporal.service';

const MAX_CLOCK_SKEW_MS = 10 * 60_000;

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly temporal: TemporalService,
  ) {}

  async list(tenantId: string, status: 'pending' | 'all'): Promise<ApprovalRequest[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ approval: approvalRequests, agentName: agents.name })
        .from(approvalRequests)
        .innerJoin(agents, eq(agents.id, approvalRequests.agentId))
        .where(status === 'pending' ? eq(approvalRequests.status, 'pending') : undefined)
        .orderBy(desc(approvalRequests.createdAt))
        .limit(200);
      return rows.map((r) => toApproval(r.approval, r.agentName));
    });
  }

  async get(tenantId: string, id: string): Promise<ApprovalRequest> {
    return this.db.tenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ approval: approvalRequests, agentName: agents.name })
        .from(approvalRequests)
        .innerJoin(agents, eq(agents.id, approvalRequests.agentId))
        .where(eq(approvalRequests.id, id));
      if (!row) throw new NotFoundException('Approval not found');
      return toApproval(row.approval, row.agentName);
    });
  }

  /**
   * Record a signed decision, then wake the sleeping task workflow. The
   * signature proves which registered device (and person) approved what.
   */
  async decide(session: Session, approvalId: string, input: ApprovalDecisionInput): Promise<ApprovalRequest> {
    const decided = await this.db.tenant(session.tenantId, async (tx) => {
      const [approval] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId)).for('update');
      if (!approval) throw new NotFoundException('Approval not found');
      if (approval.status !== 'pending') throw new ConflictException(`Approval is already ${approval.status}`);
      if (approval.expiresAt.getTime() < Date.now()) throw new ConflictException('Approval has expired');
      if (approval.approver !== 'owner' && approval.approver !== session.role) {
        throw new ForbiddenException(`This approval is routed to ${approval.approver}`);
      }
      if (session.role === 'member') throw new ForbiddenException('Members cannot approve agent actions');

      const [key] = await tx
        .select()
        .from(deviceKeys)
        .where(and(eq(deviceKeys.id, input.keyId), eq(deviceKeys.principalId, session.principalId), isNull(deviceKeys.revokedAt)));
      if (!key) throw new ForbiddenException('Unknown or revoked device key');
      if (Math.abs(Date.parse(input.signedAt) - Date.now()) > MAX_CLOCK_SKEW_MS) {
        throw new BadRequestException('Signature timestamp is too far from server time');
      }
      const message = approvalSigningMessage({
        approvalId,
        decision: input.decision,
        editedArgs: input.editedArgs ?? null,
        notes: input.notes ?? null,
        signedAt: input.signedAt,
      });
      if (!verifyEd25519(key.publicKey, message, input.signature)) throw new ForbiddenException('Invalid approval signature');

      const [updated] = await tx
        .update(approvalRequests)
        .set({
          status: input.decision,
          decidedBy: session.principalId,
          decidedAt: new Date(),
          decisionNotes: input.notes ?? null,
          editedArgs: input.editedArgs ?? null,
          signature: input.signature,
          signingKeyId: key.id,
          signedAt: new Date(input.signedAt),
        })
        .where(eq(approvalRequests.id, approvalId))
        .returning();

      if (input.decision === 'rejected') {
        await tx.update(toolCalls).set({ status: 'rejected' }).where(eq(toolCalls.id, approval.toolCallId!));
        await addFeedback(tx, approval.taskId!, {
          source: 'approval',
          text: `The owner rejected "${approval.summary}"${input.notes ? ` with this note: "${input.notes}"` : ''}. Revise your approach.`,
        });
      } else if (input.decision === 'edited') {
        await addFeedback(tx, approval.taskId!, {
          source: 'approval',
          text: `The owner edited "${approval.summary}" before approving${input.notes ? `: "${input.notes}"` : ''}. The edited version was used.`,
        });
      }
      await this.audit.append(tx, session.tenantId, {
        type: 'approval.decided',
        actor: { id: session.principalId, kind: 'human' },
        goalId: approval.goalId,
        taskId: approval.taskId,
        refId: approvalId,
        payload: {
          tool: approval.tool,
          decision: input.decision,
          notes: input.notes ?? null,
          editedArgs: input.editedArgs ?? null,
          signature: input.signature,
          keyId: key.id,
          signedAt: input.signedAt,
        },
      });
      const [agent] = await tx.select({ name: agents.name }).from(agents).where(eq(agents.id, approval.agentId));
      return toApproval(updated!, agent?.name ?? 'Agent');
    });

    try {
      await this.temporal.deliverApproval(decided.taskId!, { approvalId, decision: input.decision as 'approved' | 'rejected' | 'edited' });
    } catch (err) {
      // The decision is saved; the workflow picks it up when signalled again.
      this.logger.error(`Could not signal task ${decided.taskId}: ${(err as Error).message}`);
    }
    return decided;
  }

  /** Mobile batch review: many low-risk approvals in one go, each signed. */
  async batch(session: Session, input: BatchApprovalInput) {
    const results = [];
    for (const d of input.decisions) {
      try {
        await this.decide(session, d.approvalId, d);
        results.push({ approvalId: d.approvalId, ok: true });
      } catch (err) {
        results.push({ approvalId: d.approvalId, ok: false, error: (err as Error).message });
      }
    }
    return { results };
  }
}
