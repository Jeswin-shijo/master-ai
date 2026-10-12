import { eq, sql } from 'drizzle-orm';
import type { TaskFeedback } from '../db/schema';
import { agents, goals, tasks, tenants, workspaces } from '../db/schema';
import type { Tx } from '../db/db.service';
import { DEFAULT_TENANT_SETTINGS } from '../common/mappers';

/** Everything an activity needs to reason about one task, loaded under RLS. */
export async function loadTaskContext(tx: Tx, taskId: string) {
  const [row] = await tx
    .select({ task: tasks, goal: goals, agent: agents, workspace: workspaces, tenant: tenants })
    .from(tasks)
    .innerJoin(goals, eq(goals.id, tasks.goalId))
    .innerJoin(agents, eq(agents.id, tasks.agentId))
    .innerJoin(workspaces, eq(workspaces.id, goals.workspaceId))
    .innerJoin(tenants, eq(tenants.id, tasks.tenantId))
    .where(eq(tasks.id, taskId));
  if (!row) throw new Error(`Task ${taskId} not found`);
  const settings = { ...DEFAULT_TENANT_SETTINGS, ...row.tenant.settings, calls: { ...DEFAULT_TENANT_SETTINGS.calls, ...row.tenant.settings.calls } };
  return { ...row, tenant: { ...row.tenant, settings } };
}

export type TaskContext = Awaited<ReturnType<typeof loadTaskContext>>;

export async function addFeedback(tx: Tx, taskId: string, item: Omit<TaskFeedback, 'at'>) {
  const entry: TaskFeedback = { ...item, at: new Date().toISOString() };
  await tx
    .update(tasks)
    .set({ feedback: sql`${tasks.feedback} || ${JSON.stringify([entry])}::jsonb` })
    .where(eq(tasks.id, taskId));
}

/** Add model usage to the task and its goal. */
export async function addUsage(tx: Tx, taskId: string | null, goalId: string, tokens: number, costInr: number) {
  if (taskId) {
    await tx
      .update(tasks)
      .set({ tokens: sql`${tasks.tokens} + ${tokens}`, costInr: sql`${tasks.costInr} + ${costInr}` })
      .where(eq(tasks.id, taskId));
  }
  await tx
    .update(goals)
    .set({ tokens: sql`${goals.tokens} + ${tokens}`, costInr: sql`${goals.costInr} + ${costInr}`, updatedAt: new Date() })
    .where(eq(goals.id, goalId));
}
