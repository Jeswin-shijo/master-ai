import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { approvalSigningMessage, type ApprovalDecisionInput, type ApprovalRequest, type BatchApprovalInput } from '@onehuman/schemas';
import { AuditService } from '../audit/audit.service';
import type { Session } from '../common/auth';
import { verifyEd25519 } from '../common/crypto';
import { toApproval } from '../common/mappers';
import { DbService } from '../db/db.service';
import { agents, approvalRequests, caseStages, deviceKeys, principals, toolCalls } from '../db/schema';
import { batchRefusal, mayDecide } from './may-decide';
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
   * Record a signed decision, then wake whatever waits for it: the task
   * workflow for an action, the stage workflow for a case gate. The signature
   * proves which registered device (and person) decided what.
   */
  async decide(session: Session, approvalId: string, input: ApprovalDecisionInput, opts: { batch?: boolean } = {}): Promise<ApprovalRequest> {
    const { view, stageWorkflowId } = await this.db.tenant(session.tenantId, async (tx) => {
      const [approval] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId)).for('update');
      if (!approval) throw new NotFoundException('Approval not found');
      if (approval.status !== 'pending') throw new ConflictException(`Approval is already ${approval.status}`);
      if (approval.expiresAt.getTime() < Date.now()) throw new ConflictException('Approval has expired');
      const [me] = await tx.select({ approverRoles: principals.approverRoles }).from(principals).where(eq(principals.id, session.principalId));
      if (!mayDecide({ role: session.role, approverRoles: me?.approverRoles ?? [] }, approval.approver)) {
        throw new ForbiddenException(`This approval is for the ${approval.approver.replace(/-/g, ' ')}.`);
      }
      const refused = opts.batch ? batchRefusal(approval.kind) : null;
      if (refused) throw new BadRequestException(refused);
      if (approval.kind === 'case_gate' && input.decision === 'edited') {
        throw new BadRequestException('Approve or reject this step. Only agent actions can be edited.');
      }

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

      if (approval.kind === 'action') {
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
      }
      await this.audit.append(tx, session.tenantId, {
        type: 'approval.decided',
        actor: { id: session.principalId, kind: 'human' },
        goalId: approval.goalId,
        taskId: approval.taskId,
        refId: approvalId,
        payload: {
          kind: approval.kind,
          tool: approval.tool,
          summary: approval.summary,
          decision: input.decision,
          notes: input.notes ?? null,
          editedArgs: input.editedArgs ?? null,
          signature: input.signature,
          keyId: key.id,
          signedAt: input.signedAt,
          ...(approval.caseId && { caseId: approval.caseId, stage: approval.stage }),
        },
      });
      const [agent] = await tx.select({ name: agents.name }).from(agents).where(eq(agents.id, approval.agentId));

      let stageWorkflowId: string | null = null;
      if (approval.kind === 'case_gate') {
        const [stage] = await tx
          .select({ workflowId: caseStages.workflowId })
          .from(caseStages)
          .where(and(eq(caseStages.caseId, approval.caseId!), eq(caseStages.stage, approval.stage!)))
          .orderBy(desc(caseStages.attempt))
          .limit(1);
        stageWorkflowId = stage?.workflowId ?? null;
      }
      return { view: toApproval(updated!, agent?.name ?? 'Agent'), stageWorkflowId };
    });

    try {
      if (view.kind === 'case_gate') {
        if (stageWorkflowId) {
          await this.temporal.deliverGateDecision(stageWorkflowId, {
            approvalId,
            decision: input.decision as 'approved' | 'rejected',
            ...(input.notes && { notes: input.notes }),
          });
        }
      } else {
        await this.temporal.deliverApproval(view.taskId!, { approvalId, decision: input.decision });
      }
    } catch (err) {
      // The decision is saved; the workflow picks it up when signalled again.
      this.logger.error(`Could not signal the workflow for approval ${approvalId}: ${(err as Error).message}`);
    }
    return view;
  }

  /** Mobile batch review: many low-risk approvals in one go, each signed. */
  async batch(session: Session, input: BatchApprovalInput) {
    const results = [];
    for (const d of input.decisions) {
      try {
        await this.decide(session, d.approvalId, d, { batch: true });
        results.push({ approvalId: d.approvalId, ok: true });
      } catch (err) {
        results.push({ approvalId: d.approvalId, ok: false, error: (err as Error).message });
      }
    }
    return { results };
  }
}
