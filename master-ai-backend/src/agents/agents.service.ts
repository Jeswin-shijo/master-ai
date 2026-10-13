import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { AgentView, AutonomyOverride, AutonomyOverrideInput, AutonomySuggestion, UpdateAgentInput } from '@onehuman/schemas';
import { CASE_COORDINATOR_ROLE } from '@onehuman/agent-kit';
import { AuditService } from '../audit/audit.service';
import type { Session } from '../common/auth';
import { DbService, type Tx } from '../db/db.service';
import { agents, approvalRequests, autonomyOverrides, llmCalls, tasks } from '../db/schema';
import { TenancyService } from '../tenancy/tenancy.service';

/** Consecutive clean approvals before the platform suggests earned autonomy. */
const EARNED_AUTONOMY_STREAK = 5;

/** Agent studio: inspect, tune, pause and grant earned autonomy to agents. */
@Injectable()
export class AgentsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
  ) {}

  async list(tenantId: string): Promise<AgentView[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const rows = await tx.select().from(agents).orderBy(asc(agents.createdAt));
      const views: AgentView[] = [];
      for (const a of rows) views.push(await this.view(tx, a));
      return views;
    });
  }

  async get(tenantId: string, id: string): Promise<AgentView> {
    return this.db.tenant(tenantId, async (tx) => this.view(tx, await this.row(tx, id)));
  }

  async update(session: Session, id: string, input: UpdateAgentInput): Promise<AgentView> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const agent = await this.row(tx, id);
      const spec = {
        ...agent.spec,
        ...(input.autonomy !== undefined && { autonomy: input.autonomy }),
        ...(input.instructions !== undefined && { instructions: input.instructions }),
        budgets: { ...agent.spec.budgets, ...input.budgets },
      };
      const [row] = await tx
        .update(agents)
        .set({ spec, autonomy: spec.autonomy, updatedAt: new Date() })
        .where(eq(agents.id, id))
        .returning();
      await this.audit.append(tx, session.tenantId, {
        type: 'agent.updated',
        actor: { id: session.principalId, kind: 'human' },
        refId: id,
        payload: { changes: { ...input } },
      });
      return this.view(tx, row!);
    });
  }

  /** Kill switch for one agent. Its running tasks pause at the next step. */
  async setPaused(session: Session, id: string, paused: boolean): Promise<AgentView> {
    const { view, taskIds, stageIds } = await this.db.tenant(session.tenantId, async (tx) => {
      await this.row(tx, id);
      const [row] = await tx.update(agents).set({ status: paused ? 'paused' : 'active', updatedAt: new Date() }).where(eq(agents.id, id)).returning();
      await this.audit.append(tx, session.tenantId, {
        type: paused ? 'agent.paused' : 'agent.resumed',
        actor: { id: session.principalId, kind: 'human' },
        refId: id,
        payload: { name: row!.name },
      });
      return {
        view: await this.view(tx, row!),
        taskIds: await this.tenancy.activeTasks(tx, { agentId: id, runnableOnly: !paused }),
        // The Case coordinator holds every stage of its workspace.
        stageIds: row!.role === CASE_COORDINATOR_ROLE ? await this.tenancy.activeStages(tx, { workspaceId: row!.workspaceId }) : [],
      };
    });
    await this.tenancy.signal(taskIds, paused, stageIds);
    return view;
  }

  /**
   * Earned autonomy: when an agent's requests for one tool are approved
   * unchanged many times in a row, suggest letting it act alone (Level 3).
   * The owner decides; nothing changes automatically.
   */
  async suggestions(tenantId: string): Promise<AutonomySuggestion[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ agentId: approvalRequests.agentId, tool: approvalRequests.tool, status: approvalRequests.status, level: sql<number>`(${approvalRequests.decision}->>'level')::int` })
        .from(approvalRequests)
        .where(sql`${approvalRequests.status} in ('approved', 'rejected', 'edited') and ${approvalRequests.kind} = 'action'`)
        .orderBy(desc(approvalRequests.decidedAt));
      const overrides = await tx.select().from(autonomyOverrides);
      const has = new Set(overrides.map((o) => `${o.agentId}:${o.tool}`));
      const streaks = new Map<string, { agentId: string; tool: string; count: number; broken: boolean }>();
      for (const r of rows) {
        const key = `${r.agentId}:${r.tool}`;
        const s = streaks.get(key) ?? { agentId: r.agentId, tool: r.tool, count: 0, broken: false };
        if (!s.broken) {
          if (r.status === 'approved') s.count++;
          else s.broken = true;
        }
        streaks.set(key, s);
      }
      return [...streaks.values()]
        .filter((s) => s.count >= EARNED_AUTONOMY_STREAK && !has.has(`${s.agentId}:${s.tool}`))
        .map((s) => ({ agentId: s.agentId, tool: s.tool, consecutiveCleanApprovals: s.count, suggestedLevel: 3 as const }));
    });
  }

  async addOverride(session: Session, agentId: string, input: AutonomyOverrideInput): Promise<AutonomyOverride> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const agent = await this.row(tx, agentId);
      if (!agent.spec.tools.includes(input.tool)) throw new BadRequestException(`${agent.name} does not use ${input.tool}`);
      const [row] = await tx
        .insert(autonomyOverrides)
        .values({ tenantId: session.tenantId, agentId, tool: input.tool, level: input.level, createdBy: session.principalId })
        .onConflictDoUpdate({ target: [autonomyOverrides.agentId, autonomyOverrides.tool], set: { level: input.level, createdBy: session.principalId } })
        .returning();
      await this.audit.append(tx, session.tenantId, {
        type: 'autonomy.override_set',
        actor: { id: session.principalId, kind: 'human' },
        refId: agentId,
        payload: { agent: agent.name, tool: input.tool, level: input.level },
      });
      return { id: row!.id, tool: row!.tool, level: row!.level as 1 | 2 | 3, createdAt: row!.createdAt.toISOString() };
    });
  }

  /** Revoke earned autonomy in one tap. */
  async removeOverride(session: Session, agentId: string, overrideId: string) {
    await this.db.tenant(session.tenantId, async (tx) => {
      const [row] = await tx
        .delete(autonomyOverrides)
        .where(and(eq(autonomyOverrides.id, overrideId), eq(autonomyOverrides.agentId, agentId)))
        .returning();
      if (!row) throw new NotFoundException('Override not found');
      await this.audit.append(tx, session.tenantId, {
        type: 'autonomy.override_removed',
        actor: { id: session.principalId, kind: 'human' },
        refId: agentId,
        payload: { tool: row.tool },
      });
    });
    return { ok: true as const };
  }

  private async row(tx: Tx, id: string) {
    const [agent] = await tx.select().from(agents).where(eq(agents.id, id));
    if (!agent) throw new NotFoundException('Agent not found');
    return agent;
  }

  private async view(tx: Tx, a: typeof agents.$inferSelect): Promise<AgentView> {
    const [stats] = await tx.execute<{ completed: number; requested: number; rejected: number; spend: number }>(sql`
      select
        (select count(*)::int from ${tasks} where agent_id = ${a.id} and status = 'completed') as completed,
        (select count(*)::int from ${approvalRequests} where agent_id = ${a.id} and kind = 'action') as requested,
        (select count(*)::int from ${approvalRequests} where agent_id = ${a.id} and kind = 'action' and status = 'rejected') as rejected,
        (select coalesce(sum(l.cost_inr), 0)::float from ${llmCalls} l join ${tasks} t on t.id = l.task_id where t.agent_id = ${a.id}) as spend
    `).then((r) => r.rows);
    const overrides = await tx.select().from(autonomyOverrides).where(eq(autonomyOverrides.agentId, a.id));
    return {
      id: a.id,
      workspaceId: a.workspaceId,
      role: a.role,
      name: a.name,
      description: a.spec.description,
      status: a.status,
      autonomy: a.autonomy as 1 | 2 | 3 | 4,
      tools: a.spec.tools,
      spec: a.spec,
      model: { tier: a.spec.model.tier, fallback: a.spec.model.fallback, dataClass: a.spec.model.data_class },
      stats: {
        tasksCompleted: stats?.completed ?? 0,
        approvalsRequested: stats?.requested ?? 0,
        approvalsRejected: stats?.rejected ?? 0,
        spendInr: Number(stats?.spend ?? 0),
      },
      overrides: overrides.map((o) => ({ id: o.id, tool: o.tool, level: o.level as 1 | 2 | 3, createdAt: o.createdAt.toISOString() })),
    };
  }
}
