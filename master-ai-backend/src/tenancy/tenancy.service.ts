import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { TenantSettingsInput, TenantSummary, Workspace } from '@onehuman/schemas';
import { AuditService } from '../audit/audit.service';
import type { Session } from '../common/auth';
import { toTenant, toWorkspace } from '../common/mappers';
import { DbService, type Tx } from '../db/db.service';
import { agents, goals, tasks, tenants, workspaces } from '../db/schema';
import { TemporalService } from '../orchestration/temporal.service';
import { PolicyService } from '../policy/policy.service';
import { TwilioService } from '../voice/twilio';

const ACTIVE_TASK_STATES = ['running', 'waiting_approval', 'waiting_on_team', 'paused'];

/** Tenant settings, workspaces and the kill switch. */
@Injectable()
export class TenancyService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly temporal: TemporalService,
    private readonly policy: PolicyService,
    private readonly twilio: TwilioService,
  ) {}

  async get(tenantId: string): Promise<TenantSummary> {
    return this.db.tenant(tenantId, async (tx) => toTenant(await this.tenantRow(tx, tenantId)));
  }

  async updateSettings(session: Session, input: TenantSettingsInput): Promise<TenantSummary> {
    const twilio = this.twilio.status();
    if (input.calls?.provider === 'twilio' && !twilio.configured) {
      throw new BadRequestException(`Real calls need Twilio set up on the server first. Missing: ${twilio.missing.join(', ')}`);
    }
    return this.db.tenant(session.tenantId, async (tx) => {
      const current = await this.tenantRow(tx, session.tenantId);
      const [row] = await tx
        .update(tenants)
        .set({ settings: { ...toTenant(current).settings, ...input, calls: { ...toTenant(current).settings.calls, ...input.calls } } })
        .where(eq(tenants.id, session.tenantId))
        .returning();
      await this.audit.append(tx, session.tenantId, { type: 'tenant.settings_updated', actor: { id: session.principalId, kind: 'human' }, payload: { ...input } });
      return toTenant(row!);
    });
  }

  /** Kill switch for the whole company: every running agent stops at its next step. */
  async setTenantPaused(session: Session, paused: boolean): Promise<TenantSummary> {
    const { tenant, taskIds } = await this.db.tenant(session.tenantId, async (tx) => {
      const [row] = await tx.update(tenants).set({ status: paused ? 'paused' : 'active' }).where(eq(tenants.id, session.tenantId)).returning();
      await this.audit.append(tx, session.tenantId, { type: paused ? 'tenant.paused' : 'tenant.resumed', actor: { id: session.principalId, kind: 'human' }, payload: {} });
      return { tenant: toTenant(row!), taskIds: await this.activeTasks(tx, { runnableOnly: !paused }) };
    });
    await this.signal(taskIds, paused);
    return tenant;
  }

  async listWorkspaces(tenantId: string): Promise<Workspace[]> {
    return this.db.tenant(tenantId, async (tx) => (await tx.select().from(workspaces).orderBy(desc(workspaces.createdAt))).map(toWorkspace));
  }

  async getWorkspace(tenantId: string, id: string): Promise<Workspace> {
    return this.db.tenant(tenantId, async (tx) => {
      const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, id));
      if (!ws) throw new NotFoundException('Workspace not found');
      return toWorkspace(ws);
    });
  }

  async workspacePolicy(tenantId: string, id: string) {
    return this.db.tenant(tenantId, async (tx) => {
      const row = await this.policy.current(tx, id);
      return { version: row.version, rules: [...row.packRules, ...row.tenantRules], cedar: row.cedar };
    });
  }

  async setWorkspacePaused(session: Session, id: string, paused: boolean): Promise<Workspace> {
    const { ws, taskIds } = await this.db.tenant(session.tenantId, async (tx) => {
      const [row] = await tx.update(workspaces).set({ status: paused ? 'paused' : 'active' }).where(eq(workspaces.id, id)).returning();
      if (!row) throw new NotFoundException('Workspace not found');
      await this.audit.append(tx, session.tenantId, {
        type: paused ? 'workspace.paused' : 'workspace.resumed',
        actor: { id: session.principalId, kind: 'human' },
        refId: id,
        payload: { name: row.name },
      });
      return { ws: toWorkspace(row), taskIds: await this.activeTasks(tx, { workspaceId: id, runnableOnly: !paused }) };
    });
    await this.signal(taskIds, paused);
    return ws;
  }

  /** Running tasks in scope, for pause/resume signals. */
  async activeTasks(tx: Tx, scope: { workspaceId?: string; agentId?: string; runnableOnly?: boolean } = {}): Promise<string[]> {
    const conditions = [inArray(tasks.status, ACTIVE_TASK_STATES)];
    if (scope.agentId) conditions.push(eq(tasks.agentId, scope.agentId));
    if (scope.workspaceId) conditions.push(eq(goals.workspaceId, scope.workspaceId));
    // When resuming, skip tasks still held by another switch (a paused agent or workspace).
    if (scope.runnableOnly) conditions.push(eq(agents.status, 'active'), eq(workspaces.status, 'active'));
    const rows = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(goals, eq(goals.id, tasks.goalId))
      .innerJoin(agents, eq(agents.id, tasks.agentId))
      .innerJoin(workspaces, eq(workspaces.id, goals.workspaceId))
      .where(and(...conditions));
    return rows.map((r) => r.id);
  }

  async signal(taskIds: string[], paused: boolean) {
    if (paused) await this.temporal.pauseTasks(taskIds);
    else await this.temporal.resumeTasks(taskIds);
  }

  private async tenantRow(tx: Tx, tenantId: string) {
    const [row] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!row) throw new NotFoundException('Company not found');
    return row;
  }
}
