import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { amountOf, narrateStep, prepareArgs, resolveTool } from '@onehuman/agent-kit';
import { AuditService, SYSTEM } from '../audit/audit.service';
import { describeAction, truncate, type ActionTarget } from '../common/mappers';
import { ConnectorsService } from '../connectors/connectors.service';
import { DbService, type Tx } from '../db/db.service';
import { approvalRequests, records, tasks, toolCalls } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PolicyService } from '../policy/policy.service';
import { addFeedback, loadTaskContext, type TaskContext } from './context';
import type { ActionDecisionResult, ApprovalCreated } from './shared';

/** Everything that happens to a task between agent steps. Each method is a Temporal activity. */
@Injectable()
export class TaskLifecycleService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly connectors: ConnectorsService,
    private readonly notifications: NotificationsService,
  ) {}

  async startTask(tenantId: string, taskId: string): Promise<{ paused: boolean }> {
    return this.db.tenant(tenantId, async (tx) => {
      const ctx = await loadTaskContext(tx, taskId);
      if (ctx.task.status === 'pending') {
        await tx.update(tasks).set({ status: 'running', startedAt: new Date(), workflowId: `task-${taskId}` }).where(eq(tasks.id, taskId));
        await this.audit.append(tx, tenantId, {
          type: 'task.started',
          actor: { id: ctx.agent.id, kind: 'agent' },
          goalId: ctx.goal.id,
          taskId,
          payload: { title: ctx.task.title, agentName: ctx.agent.name },
        });
      }
      return { paused: isPaused(ctx) };
    });
  }

  async setTaskPaused(tenantId: string, taskId: string, paused: boolean) {
    await this.db.tenant(tenantId, async (tx) => {
      const ctx = await loadTaskContext(tx, taskId);
      await tx
        .update(tasks)
        .set({ status: paused ? 'paused' : 'running', waitingOn: paused ? 'Paused by kill switch' : null })
        .where(eq(tasks.id, taskId));
      await this.audit.append(tx, tenantId, {
        type: paused ? 'task.paused' : 'task.resumed',
        actor: SYSTEM,
        goalId: ctx.goal.id,
        taskId,
        payload: { title: ctx.task.title },
      });
    });
  }

  /** Ask the policy engine about a proposed action and record its decision. */
  async evaluateAction(tenantId: string, taskId: string, toolCallId: string): Promise<ActionDecisionResult> {
    return this.db.tenant(tenantId, async (tx) => {
      const ctx = await loadTaskContext(tx, taskId);
      const call = await this.toolCall(tx, toolCallId);
      const tool = resolveTool(ctx.workspace.pack, call.tool);
      if (!tool) throw new Error(`Unknown tool ${call.tool}`);

      const decision = await this.policy.decide({
        tx,
        tool,
        args: call.args,
        agent: ctx.agent,
        workspace: { id: ctx.workspace.id, status: ctx.workspace.status },
        tenant: { id: ctx.tenant.id, status: ctx.tenant.status, settings: ctx.tenant.settings },
        moneySpentInr: ctx.task.moneySpentInr,
        untrustedOrigin: ctx.goal.origin === 'inbound',
      });
      await tx
        .update(toolCalls)
        .set({ decision, status: decision.level === 5 ? 'blocked' : decision.level === 4 ? 'awaiting_approval' : 'proposed' })
        .where(eq(toolCalls.id, toolCallId));
      await this.audit.append(tx, tenantId, {
        type: 'policy.decided',
        actor: SYSTEM,
        goalId: ctx.goal.id,
        taskId,
        refId: toolCallId,
        payload: { tool: call.tool, level: decision.level, riskScore: decision.riskScore, reasons: decision.reasons, policyVersion: decision.policyVersion },
      });
      if (decision.level === 5) {
        await this.audit.append(tx, tenantId, {
          type: 'action.blocked',
          actor: SYSTEM,
          goalId: ctx.goal.id,
          taskId,
          refId: toolCallId,
          payload: { tool: call.tool, reason: decision.reasons.join('; ') },
        });
        await addFeedback(tx, taskId, { source: 'policy', text: `${call.tool} was blocked: ${decision.reasons.join('; ')}. Do not retry it.` });
      }
      return { level: decision.level, delegate: tool.primitive.control === 'delegate' };
    });
  }

  /** Run an allowed (or approved) action through the connector gateway. */
  async executeAction(tenantId: string, taskId: string, toolCallId: string, approvalId?: string) {
    await this.db.tenant(tenantId, async (tx) => {
      const ctx = await loadTaskContext(tx, taskId);
      const call = await this.toolCall(tx, toolCallId);
      if (call.status === 'executed') return; // idempotent on activity retry
      const tool = resolveTool(ctx.workspace.pack, call.tool)!;

      let args = call.args;
      if (approvalId) {
        const [approval] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId));
        if (approval?.status === 'edited' && approval.editedArgs) {
          const prepared = prepareArgs(tool, approval.editedArgs);
          if (!prepared.ok) {
            await tx.update(toolCalls).set({ status: 'failed', error: `Edited arguments invalid: ${prepared.issues.join('; ')}` }).where(eq(toolCalls.id, toolCallId));
            await addFeedback(tx, taskId, { source: 'approval', text: `The owner's edited arguments were invalid: ${prepared.issues.join('; ')}` });
            return;
          }
          args = prepared.args;
          // Edited arguments still have to clear hard limits (Level 5 rules).
          const recheck = await this.policy.decide({
            tx,
            tool,
            args,
            agent: ctx.agent,
            workspace: { id: ctx.workspace.id, status: ctx.workspace.status },
            tenant: { id: ctx.tenant.id, status: ctx.tenant.status, settings: ctx.tenant.settings },
            moneySpentInr: ctx.task.moneySpentInr,
            untrustedOrigin: false,
          });
          if (recheck.level === 5) {
            await tx.update(toolCalls).set({ status: 'blocked', error: recheck.reasons.join('; ') }).where(eq(toolCalls.id, toolCallId));
            await this.audit.append(tx, tenantId, {
              type: 'action.blocked',
              actor: SYSTEM,
              goalId: ctx.goal.id,
              taskId,
              refId: toolCallId,
              payload: { tool: call.tool, reason: `Edited action blocked: ${recheck.reasons.join('; ')}` },
            });
            return;
          }
        }
      }

      try {
        const result = await this.connectors.execute(
          { tx, tenantId, workspace: ctx.workspace, toolCallId, actor: { id: ctx.agent.id, kind: 'agent' } },
          tool,
          args,
        );
        await tx.update(toolCalls).set({ status: 'executed', args, result, executedAt: new Date() }).where(eq(toolCalls.id, toolCallId));
        if (tool.risk.spendsMoney) {
          const amount = amountOf(tool, args) ?? 0;
          await tx.update(tasks).set({ moneySpentInr: sql`${tasks.moneySpentInr} + ${amount}` }).where(eq(tasks.id, taskId));
        }
        await this.audit.append(tx, tenantId, {
          type: 'action.executed',
          actor: { id: ctx.agent.id, kind: 'agent' },
          goalId: ctx.goal.id,
          taskId,
          refId: toolCallId,
          payload: { tool: call.tool, args, approvalId: approvalId ?? null, result: summarizeResult(result) },
        });
      } catch (err) {
        const message = (err as Error).message;
        await tx.update(toolCalls).set({ status: 'failed', error: message }).where(eq(toolCalls.id, toolCallId));
        await addFeedback(tx, taskId, { source: 'tool', text: `${call.tool} failed: ${message}` });
        await this.audit.append(tx, tenantId, {
          type: 'action.failed',
          actor: { id: ctx.agent.id, kind: 'agent' },
          goalId: ctx.goal.id,
          taskId,
          refId: toolCallId,
          payload: { tool: call.tool, error: message },
        });
      }
    });
  }

  /** Level 4: create an approval request. The workflow then sleeps until a signed decision arrives. */
  async requestApproval(tenantId: string, taskId: string, toolCallId: string): Promise<ApprovalCreated> {
    const created = await this.db.tenant(tenantId, async (tx) => {
      const ctx = await loadTaskContext(tx, taskId);
      const call = await this.toolCall(tx, toolCallId);
      const [existing] = await tx.select().from(approvalRequests).where(eq(approvalRequests.toolCallId, toolCallId));
      const ttlMs = ctx.tenant.settings.approvalTtlHours * 3_600_000;
      if (existing) return { approvalId: existing.id, ttlMs: Math.max(0, existing.expiresAt.getTime() - Date.now()), summary: existing.summary };

      const recent = await tx
        .select()
        .from(toolCalls)
        .where(and(eq(toolCalls.taskId, taskId), eq(toolCalls.status, 'executed')))
        .orderBy(desc(toolCalls.createdAt))
        .limit(3);
      const summary = describeAction(call.tool, call.args, await this.targetOf(tx, ctx, call.args));
      const evidence = [
        { label: 'Goal', value: ctx.goal.text },
        { label: 'Task', value: ctx.task.title },
        ...recent.reverse().map((c) => {
          const n = narrateStep({ tool: c.tool, status: c.status, args: c.args, result: c.result, pack: ctx.workspace.pack });
          return { label: 'Already done', value: truncate([n.text, ...(n.items ?? []).slice(0, 3)].join('\n'), 400) };
        }),
      ];
      const [approval] = await tx
        .insert(approvalRequests)
        .values({
          tenantId,
          goalId: ctx.goal.id,
          taskId,
          toolCallId,
          agentId: ctx.agent.id,
          tool: call.tool,
          args: call.args,
          summary,
          rationale: call.rationale,
          decision: call.decision!,
          evidence,
          costSoFarInr: ctx.task.costInr,
          approver: call.decision?.approver ?? 'owner',
          expiresAt: new Date(Date.now() + ttlMs),
        })
        .returning();
      await tx.update(tasks).set({ status: 'waiting_approval', waitingOn: `Approval: ${summary}` }).where(eq(tasks.id, taskId));
      await this.audit.append(tx, tenantId, {
        type: 'approval.requested',
        actor: { id: ctx.agent.id, kind: 'agent' },
        goalId: ctx.goal.id,
        taskId,
        refId: approval!.id,
        payload: { tool: call.tool, summary, riskScore: call.decision?.riskScore, reasons: call.decision?.reasons, approver: approval!.approver },
      });
      return { approvalId: approval!.id, ttlMs, summary };
    });
    void this.notifications.pushToTenant(tenantId, {
      title: 'Approval needed',
      body: created.summary,
      data: { approvalId: created.approvalId },
    });
    return { approvalId: created.approvalId, ttlMs: created.ttlMs };
  }

  async resumeAfterApproval(tenantId: string, taskId: string) {
    await this.db.tenant(tenantId, (tx) =>
      tx.update(tasks).set({ status: 'running', waitingOn: null }).where(eq(tasks.id, taskId)),
    );
  }

  async expireApproval(tenantId: string, taskId: string, approvalId: string) {
    await this.db.tenant(tenantId, async (tx) => {
      const [approval] = await tx
        .update(approvalRequests)
        .set({ status: 'expired' })
        .where(and(eq(approvalRequests.id, approvalId), eq(approvalRequests.status, 'pending')))
        .returning();
      if (!approval) return;
      await tx.update(toolCalls).set({ status: 'expired' }).where(eq(toolCalls.id, approval.toolCallId));
      await this.audit.append(tx, tenantId, {
        type: 'approval.expired',
        actor: SYSTEM,
        goalId: approval.goalId,
        taskId,
        refId: approvalId,
        payload: { tool: approval.tool, summary: approval.summary },
      });
    });
  }

  async completeTask(tenantId: string, taskId: string, output: { summary: string; data?: unknown }) {
    await this.db.tenant(tenantId, async (tx) => {
      const ctx = await loadTaskContext(tx, taskId);
      await tx.update(tasks).set({ status: 'completed', output, waitingOn: null, completedAt: new Date() }).where(eq(tasks.id, taskId));
      await this.audit.append(tx, tenantId, {
        type: 'task.completed',
        actor: { id: ctx.agent.id, kind: 'agent' },
        goalId: ctx.goal.id,
        taskId,
        payload: { title: ctx.task.title, agentName: ctx.agent.name, summary: output.summary },
      });
    });
  }

  async escalateTask(tenantId: string, taskId: string, reason: string) {
    const title = await this.db.tenant(tenantId, async (tx) => {
      const ctx = await loadTaskContext(tx, taskId);
      await tx.update(tasks).set({ status: 'escalated', waitingOn: reason, completedAt: new Date() }).where(eq(tasks.id, taskId));
      await this.audit.append(tx, tenantId, {
        type: 'task.escalated',
        actor: { id: ctx.agent.id, kind: 'agent' },
        goalId: ctx.goal.id,
        taskId,
        payload: { title: ctx.task.title, reason },
      });
      return ctx.task.title;
    });
    void this.notifications.pushToTenant(tenantId, { title: 'A task needs you', body: `${title}: ${reason}`, data: { taskId } });
  }

  async skipTask(tenantId: string, taskId: string, reason: string) {
    await this.db.tenant(tenantId, async (tx) => {
      const ctx = await loadTaskContext(tx, taskId);
      await tx.update(tasks).set({ status: 'skipped', waitingOn: reason }).where(eq(tasks.id, taskId));
      await this.audit.append(tx, tenantId, { type: 'task.skipped', actor: SYSTEM, goalId: ctx.goal.id, taskId, payload: { title: ctx.task.title, reason } });
    });
  }

  /** The record an action touches, so approvals read "Cancel booking for Rahul Nair". */
  private async targetOf(tx: Tx, ctx: TaskContext, args: Record<string, unknown>): Promise<ActionTarget | undefined> {
    const entity = ctx.workspace.pack.entities.find((e) => e.name === args.entity);
    if (!entity) return undefined;
    if (typeof args.id !== 'string') return { label: entity.label };
    const [row] = await tx.select().from(records).where(eq(records.id, args.id));
    const title = row && entity.title_field ? row.data[entity.title_field] : undefined;
    return { label: entity.label, title: typeof title === 'string' ? title : undefined };
  }

  private async toolCall(tx: Tx, toolCallId: string) {
    const [call] = await tx.select().from(toolCalls).where(eq(toolCalls.id, toolCallId));
    if (!call) throw new Error(`Tool call ${toolCallId} not found`);
    return call;
  }
}

function isPaused(ctx: TaskContext): boolean {
  return ctx.agent.status !== 'active' || ctx.workspace.status !== 'active' || ctx.tenant.status !== 'active';
}

function summarizeResult(result: unknown): unknown {
  const json = JSON.stringify(result) ?? 'null';
  return json.length > 1000 ? { truncated: true, preview: json.slice(0, 1000) } : result;
}
