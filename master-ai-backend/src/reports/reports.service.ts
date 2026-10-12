import { BadRequestException, Controller, Get, Injectable, Query } from '@nestjs/common';
import { desc, eq, gte, inArray, or } from 'drizzle-orm';
import type { GoalReport, GoalStatus, ReportPeriod, ResolvedPack, StepNarrative, WorkReport } from '@onehuman/schemas';
import { narrateStep, resolveTool } from '@onehuman/agent-kit';
import { CurrentSession, type Session } from '../common/auth';
import { DbService, type Tx } from '../db/db.service';
import { approvalRequests, calls, delegations, goals, records, staff, tasks, toolCalls, workspaces } from '../db/schema';

type GoalRow = typeof goals.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type CallRow = typeof toolCalls.$inferSelect;
type ApprovalRow = typeof approvalRequests.$inferSelect;
interface DelegationRow {
  goalId: string;
  status: string;
  summary: string | null;
  staffName: string;
  staffTitle: string;
  calls: number;
}

const READS = new Set(['records.search', 'records.get', 'knowledge.search']);
const MESSAGES = new Set(['message.send', 'message.draft']);
const CHANGES = new Set(['records.create', 'records.update']);
const TEAM_PROBLEM = new Set(['declined', 'blocked', 'not_done', 'unreachable']);
const FINISHED = new Set(['completed', 'partially_completed', 'failed', 'cancelled']);
const IST_OFFSET_MS = 5.5 * 3_600_000;

/**
 * Reports for owners and their clients: what each goal achieved, what is still
 * waiting, and what needs attention, told in plain sentences from the same
 * step narratives the goal page shows. Nothing here is raw data.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly db: DbService) {}

  /** Plain-language narratives for steps, looking up the records they touched. */
  async narrate(tx: Tx, pack: ResolvedPack, rows: CallRow[], approvals: ApprovalRow[] = []): Promise<Map<string, StepNarrative>> {
    const ids = [...new Set(rows.map((r) => r.args.id).filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)))];
    const recs = ids.length ? await tx.select({ id: records.id, data: records.data }).from(records).where(inArray(records.id, ids)) : [];
    const byId = new Map(recs.map((r) => [r.id, r.data]));
    const notes = new Map(approvals.map((a) => [a.toolCallId, a.decisionNotes]));
    return new Map(
      rows.map((r) => [
        r.id,
        narrateStep({
          tool: r.tool,
          status: r.status,
          args: r.args,
          result: r.result,
          error: r.error,
          notes: notes.get(r.id) ?? null,
          pack,
          record: typeof r.args.id === 'string' ? byId.get(r.args.id) ?? null : null,
        }),
      ]),
    );
  }

  /** The goal's report from rows already loaded for its detail page. */
  goalReport(
    goal: GoalRow,
    pack: ResolvedPack,
    taskRows: TaskRow[],
    callRows: CallRow[],
    narratives: Map<string, StepNarrative>,
    approvals: ApprovalRow[],
    team: DelegationRow[],
  ): GoalReport {
    const primitive = (tool: string) => resolveTool(pack, tool)?.primitive.name ?? tool;
    const executed = callRows.filter((c) => c.status === 'executed');
    const told = (c: CallRow) => narratives.get(c.id)?.text ?? '';

    // Look-ups matter in a report only when nothing else was done.
    const acted = executed.filter((c) => !READS.has(primitive(c.tool)));
    const done = [...new Set((acted.length ? acted : executed).map(told))];
    const pending = callRows.filter((c) => c.status === 'awaiting_approval' || c.status === 'running').map(told);
    const attention = [
      ...callRows.filter((c) => c.status === 'failed' || c.status === 'blocked' || c.status === 'rejected').map(told),
      ...taskRows.filter((t) => t.status === 'escalated').map((t) => `Handed back to you: ${t.title}${t.waitingOn ? ` (${t.waitingOn})` : ''}.`),
      ...team.filter((d) => TEAM_PROBLEM.has(d.status)).map((d) => d.summary ?? `${d.staffName}: ${d.status.replace(/_/g, ' ')}.`),
    ];
    const decided = approvals.filter((a) => a.status !== 'pending' && a.status !== 'expired');
    const approved = decided.filter((a) => a.status === 'approved' || a.status === 'edited').length;
    const rejected = decided.filter((a) => a.status === 'rejected').length;
    const people = [
      ...team.map((d) => `${d.staffName} (${d.staffTitle}): ${d.calls} call${d.calls === 1 ? '' : 's'}, ${d.status.replace(/_/g, ' ')}`),
      ...(approved ? [`You approved ${approved} action${approved === 1 ? '' : 's'}`] : []),
      ...(rejected ? [`You turned down ${rejected} action${rejected === 1 ? '' : 's'}`] : []),
    ];

    return {
      goalId: goal.id,
      text: goal.text,
      status: goal.status as GoalStatus,
      createdAt: goal.createdAt.toISOString(),
      completedAt: goal.completedAt?.toISOString() ?? null,
      done: done.filter(Boolean),
      pending: pending.filter(Boolean),
      attention: attention.filter(Boolean),
      people,
      counts: {
        actions: executed.filter((c) => !READS.has(primitive(c.tool))).length,
        messages: executed.filter((c) => MESSAGES.has(primitive(c.tool))).length,
        recordsChanged: executed.filter((c) => CHANGES.has(primitive(c.tool))).length,
        calls: team.reduce((n, d) => n + d.calls, 0),
        approvals: approvals.length,
      },
      costInr: goal.costInr,
    };
  }

  /** Reports for every goal in a period: today, the last 7 or 30 days, or everything. */
  async list(tenantId: string, period: ReportPeriod): Promise<WorkReport> {
    const now = new Date();
    const from = periodStart(period, now);
    return this.db.tenant(tenantId, async (tx) => {
      const goalRows = await tx
        .select()
        .from(goals)
        .where(from ? or(gte(goals.createdAt, from), gte(goals.completedAt, from)) : undefined)
        .orderBy(desc(goals.createdAt))
        .limit(200);
      const reports = await this.reportsFor(tx, goalRows);
      const totals = {
        goals: reports.length,
        finished: reports.filter((r) => FINISHED.has(r.status)).length,
        needYou: reports.filter((r) => r.attention.length > 0 || r.pending.some((p) => p.startsWith('Waiting for your approval'))).length,
        actions: reports.reduce((n, r) => n + r.counts.actions, 0),
        messages: reports.reduce((n, r) => n + r.counts.messages, 0),
        calls: reports.reduce((n, r) => n + r.counts.calls, 0),
        costInr: Math.round(reports.reduce((n, r) => n + r.costInr, 0) * 100) / 100,
      };
      return { period, from: from?.toISOString() ?? null, to: now.toISOString(), totals, goals: reports };
    });
  }

  /** One goal: narratives for its steps plus its report, for the goal page. */
  async forGoal(tx: Tx, goal: GoalRow, taskRows: TaskRow[], callRows: CallRow[], approvals: ApprovalRow[]) {
    const pack = await this.packOf(tx, goal.workspaceId);
    const narratives = await this.narrate(tx, pack, callRows, approvals);
    const team = await this.team(tx, [goal.id]);
    return { narratives, report: this.goalReport(goal, pack, taskRows, callRows, narratives, approvals, team) };
  }

  private async reportsFor(tx: Tx, goalRows: GoalRow[]): Promise<GoalReport[]> {
    if (goalRows.length === 0) return [];
    const ids = goalRows.map((g) => g.id);
    const [taskRows, callRows, approvalRows, team, wsRows] = await Promise.all([
      tx.select().from(tasks).where(inArray(tasks.goalId, ids)),
      tx.select().from(toolCalls).where(inArray(toolCalls.goalId, ids)).orderBy(toolCalls.createdAt),
      tx.select().from(approvalRequests).where(inArray(approvalRequests.goalId, ids)),
      this.team(tx, ids),
      tx.select({ id: workspaces.id, pack: workspaces.pack }).from(workspaces).where(inArray(workspaces.id, [...new Set(goalRows.map((g) => g.workspaceId))])),
    ]);
    const packs = new Map(wsRows.map((w) => [w.id, w.pack]));
    const out: GoalReport[] = [];
    for (const goal of goalRows) {
      const pack = packs.get(goal.workspaceId);
      if (!pack) continue;
      const mine = callRows.filter((c) => c.goalId === goal.id);
      const approvals = approvalRows.filter((a) => a.goalId === goal.id);
      const narratives = await this.narrate(tx, pack, mine, approvals);
      out.push(
        this.goalReport(
          goal,
          pack,
          taskRows.filter((t) => t.goalId === goal.id),
          mine,
          narratives,
          approvals,
          team.filter((d) => d.goalId === goal.id),
        ),
      );
    }
    return out;
  }

  private async team(tx: Tx, goalIds: string[]): Promise<DelegationRow[]> {
    const rows = await tx
      .select({ d: delegations, name: staff.name, title: staff.title })
      .from(delegations)
      .innerJoin(staff, eq(staff.id, delegations.staffId))
      .where(inArray(delegations.goalId, goalIds));
    if (rows.length === 0) return [];
    const callRows = await tx.select({ delegationId: calls.delegationId }).from(calls).where(inArray(calls.delegationId, rows.map((r) => r.d.id)));
    return rows.map((r) => ({
      goalId: r.d.goalId,
      status: r.d.status,
      summary: r.d.outcome?.summary ?? null,
      staffName: r.name,
      staffTitle: r.title,
      calls: callRows.filter((c) => c.delegationId === r.d.id).length,
    }));
  }

  private async packOf(tx: Tx, workspaceId: string): Promise<ResolvedPack> {
    const [ws] = await tx.select({ pack: workspaces.pack }).from(workspaces).where(eq(workspaces.id, workspaceId));
    if (!ws) throw new Error(`Workspace ${workspaceId} not found`);
    return ws.pack;
  }
}

/** Start of the period in India time: midnight today, or 7 / 30 days back. */
export function periodStart(period: ReportPeriod, now: Date): Date | null {
  if (period === 'all') return null;
  if (period === 'today') {
    const ist = new Date(now.getTime() + IST_OFFSET_MS);
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS);
  }
  return new Date(now.getTime() - (period === 'week' ? 7 : 30) * 86_400_000);
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@CurrentSession() s: Session, @Query('period') period = 'week') {
    if (!['today', 'week', 'month', 'all'].includes(period)) throw new BadRequestException('period must be today, week, month or all');
    return this.reports.list(s.tenantId, period as ReportPeriod);
  }
}
