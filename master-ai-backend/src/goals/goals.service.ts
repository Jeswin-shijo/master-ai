import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';
import type { CreateGoalInput, Goal, PlanDecisionInput } from '@onehuman/schemas';
import type { GoalDetail } from '@onehuman/sdk';
import { AuditService } from '../audit/audit.service';
import type { Session } from '../common/auth';
import { toApproval, toGoal, toTask, toToolCall } from '../common/mappers';
import { DbService } from '../db/db.service';
import { agents, approvalRequests, goals, tasks, tenants, toolCalls } from '../db/schema';
import { RecordsService } from '../records/records.service';
import { TemporalService } from '../orchestration/temporal.service';
import { ReportsService } from '../reports/reports.service';

@Injectable()
export class GoalsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly temporal: TemporalService,
    private readonly records: RecordsService,
    private readonly reports: ReportsService,
  ) {}

  /** A goal becomes a durable workflow: plan → owner review → agents → summary. */
  async create(session: Session, input: CreateGoalInput): Promise<Goal> {
    const goal = await this.db.tenant(session.tenantId, async (tx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId));
      if (tenant?.status === 'paused') throw new ConflictException('The company-wide kill switch is on. Resume to start new goals.');
      const ws = await this.records.activeWorkspace(tx, input.workspaceId);
      if (ws.status === 'paused') throw new ConflictException('This workspace is paused.');
      const [row] = await tx
        .insert(goals)
        .values({ tenantId: session.tenantId, workspaceId: ws.id, createdBy: session.principalId, text: input.text, origin: 'owner' })
        .returning();
      await this.audit.append(tx, session.tenantId, {
        type: 'goal.created',
        actor: { id: session.principalId, kind: 'human' },
        goalId: row!.id,
        payload: { text: input.text },
      });
      return row!;
    });

    const workflowId = await this.temporal.startGoal({ tenantId: session.tenantId, goalId: goal.id, autoStart: input.autoStart });
    const [updated] = await this.db.tenant(session.tenantId, (tx) =>
      tx.update(goals).set({ workflowId }).where(eq(goals.id, goal.id)).returning(),
    );
    return toGoal(updated!);
  }

  async list(tenantId: string): Promise<Goal[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const rows = await tx.select().from(goals).orderBy(desc(goals.createdAt)).limit(100);
      return rows.map(toGoal);
    });
  }

  async detail(tenantId: string, goalId: string): Promise<GoalDetail> {
    return this.db.tenant(tenantId, async (tx) => {
      const [goal] = await tx.select().from(goals).where(eq(goals.id, goalId));
      if (!goal) throw new NotFoundException('Goal not found');
      const taskRows = await tx
        .select({ task: tasks, agent: { role: agents.role, name: agents.name } })
        .from(tasks)
        .innerJoin(agents, eq(agents.id, tasks.agentId))
        .where(eq(tasks.goalId, goalId))
        .orderBy(asc(tasks.createdAt));
      const callRows = await tx.select().from(toolCalls).where(eq(toolCalls.goalId, goalId)).orderBy(asc(toolCalls.createdAt));
      const approvalRows = await tx
        .select({ approval: approvalRequests, agentName: agents.name })
        .from(approvalRequests)
        .innerJoin(agents, eq(agents.id, approvalRequests.agentId))
        .where(eq(approvalRequests.goalId, goalId))
        .orderBy(asc(approvalRequests.createdAt));
      const { narratives, report } = await this.reports.forGoal(
        tx,
        goal,
        taskRows.map((r) => r.task),
        callRows,
        approvalRows.map((r) => r.approval),
      );
      return {
        goal: toGoal(goal),
        tasks: taskRows.map((r) => toTask(r.task, r.agent)),
        toolCalls: callRows.map((c) => ({ ...toToolCall(c), narrative: narratives.get(c.id) })),
        approvals: approvalRows.map((r) => toApproval(r.approval, r.agentName)),
        report,
      };
    });
  }

  async decidePlan(session: Session, goalId: string, input: PlanDecisionInput): Promise<Goal> {
    const goal = await this.db.tenant(session.tenantId, async (tx) => {
      const [row] = await tx.select().from(goals).where(eq(goals.id, goalId));
      if (!row) throw new NotFoundException('Goal not found');
      if (row.status !== 'awaiting_plan_approval') throw new BadRequestException(`Goal is ${row.status}, not awaiting plan approval`);
      await this.audit.append(tx, session.tenantId, {
        type: input.approved ? 'goal.plan_approved' : 'goal.plan_rejected',
        actor: { id: session.principalId, kind: 'human' },
        goalId,
        payload: { notes: input.notes ?? null },
      });
      return row;
    });
    await this.temporal.decidePlan(goalId, { approved: input.approved, notes: input.notes });
    return toGoal(goal);
  }
}
