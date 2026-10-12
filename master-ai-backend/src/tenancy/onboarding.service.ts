import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PackAgent, PackDraft, PackUpdates, ResolvedPack, Workspace } from '@onehuman/schemas';
import { applyPackUpdates, countPackUpdates, emptyPackUpdates, packUpdates, validatePackRefs } from '@onehuman/agent-kit';
import { PolicyEngine } from '@onehuman/policy';
import { AuditService } from '../audit/audit.service';
import type { Session } from '../common/auth';
import { toDraft, toWorkspace } from '../common/mappers';
import { DbService, type Tx } from '../db/db.service';
import { agents, packDrafts, policies, principals, tenants, workspaces } from '../db/schema';
import { PackGenerator } from '../packs/generator.service';
import { PackRegistry } from '../packs/registry.service';
import { PolicyService } from '../policy/policy.service';
import { RecordsService } from '../records/records.service';
import { TeamService } from '../voice/team.service';

/**
 * Onboarding adapts the platform to the owner's industry: match a curated pack
 * or generate one, let the owner review it, then install it as a workspace with
 * agent identities and a versioned policy set. No code changes per industry.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly generator: PackGenerator,
    private readonly records: RecordsService,
    private readonly team: TeamService,
    private readonly registry: PackRegistry,
    private readonly policy: PolicyService,
  ) {}

  async preview(session: Session, input: { industry?: string; forceGenerate?: boolean }): Promise<PackDraft> {
    const industry =
      input.industry ??
      (await this.db.tenant(session.tenantId, async (tx) => {
        const [t] = await tx.select({ industry: tenants.industry }).from(tenants).where(eq(tenants.id, session.tenantId));
        return t!.industry;
      }));
    const draft = await this.generator.draft(session.tenantId, industry, input.forceGenerate);

    return this.db.tenant(session.tenantId, async (tx) => {
      const [row] = await tx
        .insert(packDrafts)
        .values({ tenantId: session.tenantId, industry, source: draft.source, generator: draft.generator, rationale: draft.rationale, pack: draft.pack })
        .returning();
      await this.audit.append(tx, session.tenantId, {
        type: 'pack.drafted',
        actor: { id: session.principalId, kind: 'human' },
        refId: row!.id,
        payload: { industry, packId: draft.pack.id, generator: draft.generator, agents: draft.pack.agents.length, entities: draft.pack.entities.length },
      });
      return toDraft(row!);
    });
  }

  async install(session: Session, draftId: string, sampleData: boolean): Promise<Workspace> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const [draft] = await tx.select().from(packDrafts).where(and(eq(packDrafts.id, draftId), eq(packDrafts.status, 'draft')));
      if (!draft) throw new NotFoundException('Draft not found or already installed');
      const pack = draft.pack;
      if (pack.agents.length === 0) throw new BadRequestException('Pack has no agents');
      const actor = { id: session.principalId, kind: 'human' as const };

      const [ws] = await tx
        .insert(workspaces)
        .values({ tenantId: session.tenantId, name: pack.name, packId: pack.id, packVersion: pack.version, pack })
        .returning();

      // Policy set v1 from the pack. Compiling here fails fast on a broken rule.
      const engine = new PolicyEngine({ version: 1, packRules: pack.policies });
      await tx.insert(policies).values({
        tenantId: session.tenantId,
        workspaceId: ws!.id,
        version: 1,
        packRules: pack.policies,
        tenantRules: [],
        cedar: engine.cedarText,
      });

      for (const spec of pack.agents) await this.createAgent(tx, session.tenantId, ws!.id, spec, actor);

      await tx.update(packDrafts).set({ status: 'installed' }).where(eq(packDrafts.id, draftId));
      await tx.update(tenants).set({ onboarded: true }).where(eq(tenants.id, session.tenantId));
      await this.audit.append(tx, session.tenantId, {
        type: 'pack.installed',
        actor,
        refId: ws!.id,
        payload: { packId: pack.id, version: pack.version, lineage: pack.lineage, source: pack.source, policyVersion: 1 },
      });
      if (sampleData) {
        await this.records.seedSamples(tx, session.tenantId, ws!, actor);
        await this.team.seedSamples(tx, session.tenantId, actor);
      }
      return toWorkspace(ws!);
    });
  }

  /** What the current base packs add to an installed workspace (e.g. new agents and workflows). */
  async updates(tenantId: string, workspaceId: string): Promise<PackUpdates> {
    return this.db.tenant(tenantId, async (tx) => {
      const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId));
      if (!ws) throw new NotFoundException('Workspace not found');
      return this.updatesFor(ws.pack);
    });
  }

  /** Add what the base packs gained since install. Additions only; nothing installed is replaced. */
  async applyUpdates(session: Session, workspaceId: string): Promise<Workspace> {
    return this.db.tenant(session.tenantId, async (tx) => {
      // Locked so two clicks cannot add the same agent twice.
      const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).for('update');
      if (!ws) throw new NotFoundException('Workspace not found');
      const updates = this.updatesFor(ws.pack);
      if (countPackUpdates(updates) === 0) return toWorkspace(ws);
      const pack = applyPackUpdates(ws.pack, updates);
      const issues = validatePackRefs(pack);
      if (issues.length) throw new BadRequestException(`Update does not fit this workspace: ${issues.join('; ')}`);
      const actor = { id: session.principalId, kind: 'human' as const };

      const [updated] = await tx.update(workspaces).set({ pack }).where(eq(workspaces.id, workspaceId)).returning();
      let policyVersion: number | undefined;
      if (updates.policies.length) {
        const current = await this.policy.current(tx, workspaceId);
        const engine = new PolicyEngine({ version: current.version + 1, packRules: pack.policies, tenantRules: current.tenantRules });
        policyVersion = current.version + 1;
        await tx.insert(policies).values({
          tenantId: session.tenantId,
          workspaceId,
          version: policyVersion,
          packRules: pack.policies,
          tenantRules: current.tenantRules,
          cedar: engine.cedarText,
        });
      }
      for (const spec of updates.agents) await this.createAgent(tx, session.tenantId, workspaceId, spec, actor);
      await this.audit.append(tx, session.tenantId, {
        type: 'pack.updated',
        actor,
        refId: workspaceId,
        payload: {
          summary: describeUpdates(updates),
          agents: updates.agents.map((a) => a.role),
          workflows: updates.workflows.map((w) => w.id),
          tools: updates.tools.map((t) => t.name),
          kpis: updates.kpis.map((k) => k.id),
          policies: updates.policies.length,
          ...(policyVersion && { policyVersion }),
        },
      });
      return toWorkspace(updated!);
    });
  }

  private updatesFor(installed: ResolvedPack): PackUpdates {
    const latest = this.registry.latestFor(installed);
    return latest ? packUpdates(installed, latest) : emptyPackUpdates();
  }

  /** Every agent is a principal with its own identity, permissions and budget. */
  private async createAgent(tx: Tx, tenantId: string, workspaceId: string, spec: PackAgent, actor: { id: string; kind: 'human' }) {
    const [principal] = await tx
      .insert(principals)
      .values({ tenantId, kind: 'agent', displayName: spec.name, role: spec.role })
      .returning();
    await tx.insert(agents).values({ id: principal!.id, tenantId, workspaceId, role: spec.role, name: spec.name, autonomy: spec.autonomy, spec });
    await this.audit.append(tx, tenantId, {
      type: 'agent.created',
      actor,
      refId: principal!.id,
      payload: { role: spec.role, name: spec.name, autonomy: spec.autonomy, tools: spec.tools },
    });
  }
}

function describeUpdates(u: PackUpdates): string {
  const parts = [
    u.lifecycle.whole ? '8-stage case lifecycle' : '',
    ...u.lifecycle.categories.map((c) => `${c.name} (case type)`),
    ...u.agents.map((a) => `${a.name} (agent)`),
    ...u.workflows.map((w) => `${w.name} (workflow)`),
    u.tools.length ? `${u.tools.length} tool${u.tools.length === 1 ? '' : 's'}` : '',
    u.policies.length ? `${u.policies.length} polic${u.policies.length === 1 ? 'y' : 'ies'}` : '',
    u.kpis.length ? `${u.kpis.length} KPI${u.kpis.length === 1 ? '' : 's'}` : '',
  ];
  return parts.filter(Boolean).join(', ');
}
