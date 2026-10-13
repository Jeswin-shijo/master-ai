import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { PlannedTask, ResolvedPack } from '@onehuman/schemas';
import { lifecycleOf, normalizeSnapshot, workAgents } from '@onehuman/agent-kit';
import { AuditService, SYSTEM } from '../audit/audit.service';
import { truncate } from '../common/mappers';
import { DbService } from '../db/db.service';
import { agents, cases, goals, tasks, tenants, workspaces } from '../db/schema';
import { LlmService } from '../llm/llm.service';
import { NotificationsService } from '../notifications/notifications.service';
import { addUsage } from './context';
import { offlinePlan } from './offline';
import type { PlannedTaskRef, TaskOutcome } from './shared';

const PlanSchema = z.strictObject({
  rationale: z.string(),
  tasks: z.array(
    z.strictObject({
      key: z.string(),
      title: z.string(),
      description: z.string(),
      agent_role: z.string(),
      depends_on: z.array(z.string()),
    }),
  ),
});
const PLAN_JSON_SCHEMA = (() => {
  const s = z.toJSONSchema(PlanSchema) as Record<string, unknown>;
  delete s.$schema;
  return s;
})();

const PLANNER_SYSTEM = `You are the orchestrator of ONEHUMAN OS. The business owner gives you a goal; you turn it into a small task graph for the company's AI agents.

Rules:
- Use only the agent roles listed. Give each task to the agent whose role and tools fit it.
- Prefer a listed workflow when it fits the goal; adapt its steps to the goal.
- 1 to 6 tasks. Each task is one agent's job with a clear outcome. Do not create tasks for work no agent has tools for.
- Keys are short lowercase-with-dashes ids. depends_on lists keys of tasks that must finish first.
- Descriptions must carry every detail from the goal the agent will need (names, amounts, dates).
- The owner sees your plan before it runs: write the rationale in one or two plain sentences.`;

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly llm: LlmService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Plan the goal and persist its tasks. The owner reviews the plan before it runs. */
  async planGoal(tenantId: string, goalId: string, autoStart: boolean): Promise<{ tasks: PlannedTaskRef[] }> {
    const { goal, pack, tenantName } = await this.db.tenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ goal: goals, pack: workspaces.pack, tenantName: tenants.name })
        .from(goals)
        .innerJoin(workspaces, eq(workspaces.id, goals.workspaceId))
        .innerJoin(tenants, eq(tenants.id, goals.tenantId))
        .where(eq(goals.id, goalId));
      if (!row) throw new Error(`Goal ${goalId} not found`);
      return row;
    });

    // Idempotent: if a retry finds tasks already planned, reuse them.
    const existing = await this.db.tenant(tenantId, (tx) => tx.select().from(tasks).where(eq(tasks.goalId, goalId)).orderBy(asc(tasks.createdAt)));
    if (existing.length) return { tasks: existing.map((t) => ({ id: t.id, key: t.key, dependsOn: t.dependsOn })) };

    // A case's goal follows its case type's workflow when it has one.
    const preferred = goal.caseId
      ? await this.db.tenant(tenantId, async (tx) => {
          const [c] = await tx.select({ file: cases.file }).from(cases).where(eq(cases.id, goal.caseId!));
          const category = c?.file.classify?.category;
          return lifecycleOf(normalizeSnapshot(pack)).categories.find((x) => x.id === category)?.workflow;
        })
      : undefined;
    const { plan, tokens, costInr } = await this.makePlan(tenantId, goalId, goal.text, pack, tenantName, preferred);

    return this.db.tenant(tenantId, async (tx) => {
      const agentRows = await tx.select().from(agents).where(eq(agents.workspaceId, goal.workspaceId));
      const byRole = new Map(agentRows.map((a) => [a.role, a]));
      const inserted = [];
      for (const t of plan.tasks) {
        const [row] = await tx
          .insert(tasks)
          .values({
            tenantId,
            goalId,
            key: t.key,
            title: t.title,
            description: t.description,
            agentId: byRole.get(t.agentRole)!.id,
            dependsOn: t.dependsOn,
          })
          .returning();
        inserted.push(row!);
      }
      await tx
        .update(goals)
        .set({ plan, status: autoStart ? 'running' : 'awaiting_plan_approval', updatedAt: new Date() })
        .where(eq(goals.id, goalId));
      await addUsage(tx, null, goalId, tokens, costInr);
      await this.audit.append(tx, tenantId, {
        type: 'goal.planned',
        actor: SYSTEM,
        goalId,
        payload: {
          taskCount: plan.tasks.length,
          rationale: plan.rationale,
          tasks: plan.tasks.map((t) => ({ key: t.key, title: t.title, agent: t.agentRole })),
        },
      });
      if (!autoStart) {
        void this.notifications.pushToManagers(tenantId, {
          title: 'Plan ready for review',
          body: truncate(goal.text, 100),
          data: { goalId },
        });
      }
      return { tasks: inserted.map((t) => ({ id: t.id, key: t.key, dependsOn: t.dependsOn })) };
    });
  }

  private async makePlan(tenantId: string, goalId: string, goalText: string, pack: ResolvedPack, tenantName: string, preferred?: string) {
    const offline = offlinePlan(goalText, pack, preferred);
    if (this.llm.mode === 'offline') return { plan: offline, tokens: 0, costInr: 0 };

    const agentsText = workAgents(pack)
      .map((a) => `- ${a.role}: ${a.name}. ${a.description} Tools: ${a.tools.join(', ')}`)
      .join('\n');
    const workflowsText = pack.workflows
      .map((w) => `- ${w.id}: ${w.name}. ${w.description}\n${w.steps.map((s) => `    ${s.key} (${s.agent}${s.depends_on.length ? `, after ${s.depends_on.join(', ')}` : ''}): ${s.instructions}`).join('\n')}`)
      .join('\n');
    try {
      const result = await this.llm.complete({
        tenantId,
        goalId,
        purpose: 'plan',
        tier: 'standard',
        fallbackTier: 'small',
        dataClass: 'confidential',
        system: `${PLANNER_SYSTEM}\n\nCompany: ${tenantName} (${pack.name}).\n\nAgents:\n${agentsText}\n\nWorkflows:\n${workflowsText}`,
        user: `Goal from the owner: ${goalText}\nToday: ${new Date().toISOString().slice(0, 10)}${preferred ? `\nPreferred workflow: ${preferred}. Use it unless it clearly does not fit.` : ''}`,
        jsonSchema: PLAN_JSON_SCHEMA,
        effort: 'medium',
        maxTokens: 8000,
        offline: () => ({}),
      });
      const parsed = PlanSchema.safeParse(result.json);
      const plan = parsed.success ? toPlan(parsed.data, pack) : null;
      if (plan) return { plan, tokens: result.tokens, costInr: result.costInr };
      this.logger.warn(`Model plan invalid for goal ${goalId}; using workflow match`);
      return { plan: offline, tokens: result.tokens, costInr: result.costInr };
    } catch (err) {
      this.logger.warn(`Planning failed for goal ${goalId} (${(err as Error).message}); using workflow match`);
      return { plan: offline, tokens: 0, costInr: 0 };
    }
  }

  async markGoalRunning(tenantId: string, goalId: string, actorId: string | null, approved: boolean, notes?: string) {
    await this.db.tenant(tenantId, async (tx) => {
      await tx
        .update(goals)
        .set({ status: approved ? 'running' : 'cancelled', updatedAt: new Date(), ...(approved ? {} : { completedAt: new Date(), summary: notes ? `Plan rejected: ${notes}` : 'Plan rejected' }) })
        .where(eq(goals.id, goalId));
      if (!approved) {
        await tx.update(tasks).set({ status: 'skipped' }).where(and(eq(tasks.goalId, goalId), eq(tasks.status, 'pending')));
      }
    });
  }

  async finishGoal(tenantId: string, goalId: string, outcomes: Record<string, TaskOutcome>, cancelledReason?: string) {
    await this.db.tenant(tenantId, async (tx) => {
      const rows = await tx.select().from(tasks).where(eq(tasks.goalId, goalId)).orderBy(asc(tasks.createdAt));
      const values = Object.values(outcomes);
      const status = cancelledReason
        ? 'cancelled'
        : values.length && values.every((o) => o === 'completed')
          ? 'completed'
          : values.some((o) => o === 'completed')
            ? 'partially_completed'
            : 'failed';
      const summary =
        cancelledReason ??
        rows
          .map((t) => `• ${t.title}: ${t.output?.summary ?? (t.status === 'escalated' ? `needs a human (${t.waitingOn ?? 'escalated'})` : t.status)}`)
          .join('\n');
      await tx.update(goals).set({ status, summary, completedAt: new Date(), updatedAt: new Date() }).where(eq(goals.id, goalId));
      await this.audit.append(tx, tenantId, {
        type: status === 'failed' ? 'goal.failed' : 'goal.completed',
        actor: SYSTEM,
        goalId,
        payload: { status, outcomes },
      });
    });
  }
}

function toPlan(raw: z.infer<typeof PlanSchema>, pack: ResolvedPack): { rationale: string; tasks: PlannedTask[] } | null {
  const roles = new Set(workAgents(pack).map((a) => a.role));
  if (raw.tasks.length === 0 || raw.tasks.length > 8) return null;
  const keys = new Set<string>();
  const tasksOut: PlannedTask[] = [];
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  for (const t of raw.tasks) {
    const key = slug(t.key);
    const dependsOn = t.depends_on.map(slug);
    if (!roles.has(t.agent_role) || keys.has(key)) return null;
    // Dependencies must point at earlier tasks, which also rules out cycles.
    if (!dependsOn.every((d) => keys.has(d))) return null;
    keys.add(key);
    tasksOut.push({ key, title: t.title, description: t.description, agentRole: t.agent_role, dependsOn });
  }
  return { rationale: raw.rationale, tasks: tasksOut };
}
