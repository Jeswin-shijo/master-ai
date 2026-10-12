import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PolicyDecision, PolicyRule, TenantSettings } from '@onehuman/schemas';
import type { ResolvedTool } from '@onehuman/agent-kit';
import { PolicyEngine, type TrackRecord } from '@onehuman/policy';
import type { Tx } from '../db/db.service';
import { agents, approvalRequests, autonomyOverrides, policies } from '../db/schema';

export interface DecideInput {
  tx: Tx;
  tool: ResolvedTool;
  args: Record<string, unknown>;
  agent: typeof agents.$inferSelect;
  workspace: { id: string; status: 'active' | 'paused' };
  tenant: { id: string; status: 'active' | 'paused'; settings: TenantSettings };
  moneySpentInr: number;
  untrustedOrigin: boolean;
}

/**
 * Policy & approval: loads the workspace's versioned policy set, gathers the
 * agent's track record and earned autonomy, and asks the engine. Engines are
 * cached per policy version, so a policy change takes effect immediately.
 */
@Injectable()
export class PolicyService {
  private readonly engines = new Map<string, PolicyEngine>();

  async current(tx: Tx, workspaceId: string) {
    const [row] = await tx
      .select()
      .from(policies)
      .where(eq(policies.workspaceId, workspaceId))
      .orderBy(desc(policies.version))
      .limit(1);
    if (!row) throw new Error(`No policy set for workspace ${workspaceId}`);
    return row;
  }

  engine(row: { workspaceId: string; version: number; packRules: PolicyRule[]; tenantRules: PolicyRule[] }, settings: TenantSettings): PolicyEngine {
    const key = `${row.workspaceId}:${row.version}:${JSON.stringify(settings.riskBands)}`;
    let engine = this.engines.get(key);
    if (!engine) {
      engine = new PolicyEngine({ version: row.version, packRules: row.packRules, tenantRules: row.tenantRules, bands: settings.riskBands });
      this.engines.set(key, engine);
    }
    return engine;
  }

  async decide(input: DecideInput): Promise<PolicyDecision> {
    const { tx, agent } = input;
    const policyRow = await this.current(tx, input.workspace.id);
    const [override] = await tx
      .select()
      .from(autonomyOverrides)
      .where(and(eq(autonomyOverrides.agentId, agent.id), eq(autonomyOverrides.tool, input.tool.name)));

    return this.engine(policyRow, input.tenant.settings).decide({
      tool: input.tool,
      args: input.args,
      agent: {
        id: agent.id,
        role: agent.role,
        status: agent.status,
        autonomy: agent.autonomy as 1 | 2 | 3 | 4,
        tools: agent.spec.tools,
        dataClass: agent.spec.model.data_class,
        moneyBudgetInr: agent.spec.budgets.money_per_task_inr,
      },
      workspace: input.workspace,
      tenant: { id: input.tenant.id, status: input.tenant.status },
      trackRecord: await this.trackRecord(tx, agent.id),
      override: override ? { level: override.level as 1 | 2 | 3 } : null,
      moneySpentInr: input.moneySpentInr,
      untrustedOrigin: input.untrustedOrigin,
    });
  }

  /** Outcomes of this agent's last 50 approval requests. */
  async trackRecord(tx: Tx, agentId: string): Promise<TrackRecord> {
    const [row] = await tx.execute<{ approved: number; rejected: number; edited: number }>(sql`
      select
        count(*) filter (where status = 'approved')::int as approved,
        count(*) filter (where status = 'rejected')::int as rejected,
        count(*) filter (where status = 'edited')::int as edited
      from (
        select status from ${approvalRequests}
        where agent_id = ${agentId} and status in ('approved', 'rejected', 'edited')
        order by decided_at desc limit 50
      ) recent
    `).then((r) => r.rows);
    return row ?? { approved: 0, rejected: 0, edited: 0 };
  }
}
