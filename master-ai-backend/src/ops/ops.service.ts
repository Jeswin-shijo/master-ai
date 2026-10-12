import { Controller, Get, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { KpiDef, KpiValue, OpsOverview, Pulse } from '@onehuman/schemas';
import { CurrentSession, type Session } from '../common/auth';
import { DbService, type Tx } from '../db/db.service';
import { approvalRequests, calls, delegations, llmCalls, records, tasks, toolCalls } from '../db/schema';
import { RecordsService } from '../records/records.service';

/** Start of today in India (IST), where the pilot runs. */
function startOfTodayIst(): Date {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - 5.5 * 3_600_000);
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

@Injectable()
export class OpsService {
  constructor(
    private readonly db: DbService,
    private readonly records: RecordsService,
  ) {}

  /** The owner's daily pulse: what needs them, what got done, what it cost. */
  async pulse(tenantId: string): Promise<Pulse> {
    return this.db.tenant(tenantId, (tx) => this.computePulse(tx));
  }

  async overview(tenantId: string): Promise<OpsOverview> {
    return this.db.tenant(tenantId, async (tx) => {
      const pulse = await this.computePulse(tx);
      const ws = await this.records.activeWorkspace(tx).catch(() => null);
      const kpis = ws ? await Promise.all(ws.pack.kpis.map((k) => this.kpi(tx, ws.id, k))) : [];
      return { pulse, kpis };
    });
  }

  private async computePulse(tx: Tx): Promise<Pulse> {
    const today = startOfTodayIst();
    const [row] = await tx.execute<{
      pending: number;
      running: number;
      completed: number;
      blocked: number;
      spend: number;
      calls: number;
      with_team: number;
      team_done: number;
      team_stuck: number;
    }>(sql`
      select
        (select count(*)::int from ${approvalRequests} where status = 'pending') as pending,
        (select count(*)::int from ${tasks} where status in ('running', 'waiting_approval')) as running,
        (select count(*)::int from ${tasks} where status = 'completed' and completed_at >= ${today}) as completed,
        (select count(*)::int from ${toolCalls} where status = 'blocked' and created_at >= ${today}) as blocked,
        (select coalesce(sum(cost_inr), 0)::float from ${llmCalls} where created_at >= ${today}) as spend,
        (select count(*)::int from ${calls} where created_at >= ${today}) as calls,
        (select count(*)::int from ${delegations} where status in ('assigning','accepted','in_progress')) as with_team,
        (select count(*)::int from ${delegations} where status = 'done' and completed_at >= ${today}) as team_done,
        (select count(*)::int from ${delegations} where status in ('declined','blocked','not_done','unreachable') and completed_at >= ${today}) as team_stuck
    `).then((r) => r.rows);
    const p = row ?? { pending: 0, running: 0, completed: 0, blocked: 0, spend: 0, calls: 0, with_team: 0, team_done: 0, team_stuck: 0 };
    const escalated = await tx.select({ title: tasks.title, waitingOn: tasks.waitingOn }).from(tasks).where(eq(tasks.status, 'escalated')).limit(3);

    const lines: string[] = [];
    if (p.pending) lines.push(`${p.pending} approval${p.pending === 1 ? '' : 's'} waiting for you.`);
    for (const e of escalated) lines.push(`Needs you: ${e.title}${e.waitingOn ? ` (${e.waitingOn})` : ''}.`);
    if (p.team_stuck) lines.push(`${p.team_stuck} job${p.team_stuck === 1 ? '' : 's'} with the team need${p.team_stuck === 1 ? 's' : ''} you (declined, blocked or unreachable).`);
    if (p.running) lines.push(`${p.running} task${p.running === 1 ? '' : 's'} in progress.`);
    if (p.with_team) lines.push(`${p.with_team} job${p.with_team === 1 ? ' is' : 's are'} with your team.`);
    if (p.calls || p.team_done) lines.push(`${p.calls} call${p.calls === 1 ? '' : 's'} made today; the team confirmed ${p.team_done} job${p.team_done === 1 ? '' : 's'} done.`);
    lines.push(`${p.completed} task${p.completed === 1 ? '' : 's'} completed today.`);
    if (p.blocked) lines.push(`${p.blocked} action${p.blocked === 1 ? '' : 's'} blocked by policy today.`);
    lines.push(`AI spend today: ${inr(p.spend)}.`);

    return {
      generatedAt: new Date().toISOString(),
      headline: p.pending ? `${p.pending} decision${p.pending === 1 ? '' : 's'} need you` : 'Nothing needs you right now',
      lines,
      pendingApprovals: p.pending,
      runningTasks: p.running,
      completedToday: p.completed,
      blockedToday: p.blocked,
      spendTodayInr: p.spend,
    };
  }

  private async kpi(tx: Tx, workspaceId: string, k: KpiDef): Promise<KpiValue> {
    const base = { id: k.id, name: k.name, unit: k.unit, direction: k.direction, target: k.target };
    const since = new Date(Date.now() - 30 * 86_400_000);
    if (!k.source) return { ...base, value: null, note: 'Needs a data connector' };
    if (k.source.type === 'records_count') {
      const conditions = [eq(records.workspaceId, workspaceId), eq(records.entity, k.source.entity)];
      for (const [field, value] of Object.entries(k.source.where ?? {})) conditions.push(sql`${records.data}->>${field} = ${String(value)}`);
      const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(records).where(and(...conditions));
      return { ...base, value: r?.n ?? 0 };
    }
    const metric = k.source.metric;
    const query = {
      tasks_completed: sql`select count(*)::float as v from ${tasks} where status = 'completed' and completed_at >= ${since}`,
      approval_rejection_rate: sql`select coalesce(100.0 * count(*) filter (where status = 'rejected') / nullif(count(*) filter (where status in ('approved','rejected','edited')), 0), 0)::float as v from ${approvalRequests} where created_at >= ${since}`,
      avg_approval_minutes: sql`select coalesce(avg(extract(epoch from decided_at - created_at) / 60), 0)::float as v from ${approvalRequests} where decided_at is not null and created_at >= ${since}`,
      llm_cost_inr: sql`select coalesce(sum(cost_inr), 0)::float as v from ${llmCalls} where created_at >= ${since}`,
      actions_blocked: sql`select count(*)::float as v from ${toolCalls} where status = 'blocked' and created_at >= ${since}`,
    }[metric];
    const [r] = await tx.execute<{ v: number }>(query).then((res) => res.rows);
    return { ...base, value: Math.round((r?.v ?? 0) * 100) / 100 };
  }
}

@Controller('ops')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('pulse')
  pulse(@CurrentSession() s: Session) {
    return this.ops.pulse(s.tenantId);
  }

  @Get('overview')
  overview(@CurrentSession() s: Session) {
    return this.ops.overview(s.tenantId);
  }
}
