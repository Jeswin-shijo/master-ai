import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { jobForbidPolicies } from '@onehuman/agent-kit';
import { PolicyEngine } from '@onehuman/policy';
import { JobDefSchema, PackAgentSchema, type JobInput, type PackAgent, type ResolvedPack } from '@onehuman/schemas';
import { agents, jobSettings, policies, principals, workspaces } from '../../src/db/schema';
import type { Harness, Org } from './harness';

export const JOB_TESTER = 'job-tester';
const TOOLS = ['records.search', 'knowledge.search', 'message.draft', 'message.send', 'payment.request', 'human.handoff'];

/**
 * Puts a job and its agent into an organization's workspace, as a pack with jobs
 * would on install (no pack under packs/ has jobs yet): the fixture agent
 * `job-tester` (customer-facing job card) and the job join the pack snapshot,
 * the agent gets its principal and agent rows, the policy set gets a new
 * version with the card's derived forbids, and the job is switched on.
 * Calling it again in the same organization adds the job and replaces the agent's spec.
 */
export async function installJobFixture(h: Harness, org: Org, job: JobInput, agent: Partial<PackAgent> = {}): Promise<{ agentId: string; jobId: string }> {
  const db = drizzle(h.owner);
  const spec = PackAgentSchema.parse({
    role: JOB_TESTER,
    name: 'Job tester',
    description: 'Runs the jobs the specs install.',
    tools: TOOLS,
    job: { mission: 'Answers customers for the specs and hands anything unusual to a person.', customer_facing: true },
    ...agent,
  });
  const def = JobDefSchema.parse({ ...job, agent: spec.role });

  return db.transaction(async (tx) => {
    const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, org.workspaceId)).for('update');
    if (!ws) throw new Error(`No workspace ${org.workspaceId}`);
    const forbidPrefix = `job-forbid-${spec.role}-`;
    const pack: ResolvedPack = {
      ...ws.pack,
      agents: [...ws.pack.agents.filter((a) => a.role !== spec.role), spec],
      jobs: [...(ws.pack.jobs ?? []).filter((j) => j.id !== def.id), def],
      policies: [...ws.pack.policies.filter((p) => !p.id?.startsWith(forbidPrefix)), ...jobForbidPolicies([spec])],
    };
    await tx.update(workspaces).set({ pack }).where(eq(workspaces.id, ws.id));

    const [had] = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.workspaceId, ws.id), eq(agents.role, spec.role)));
    let agentId = had?.id;
    if (agentId) {
      await tx.update(agents).set({ spec, autonomy: spec.autonomy, updatedAt: new Date() }).where(eq(agents.id, agentId));
    } else {
      const [principal] = await tx.insert(principals).values({ tenantId: org.tenantId, kind: 'agent', displayName: spec.name, role: spec.role }).returning();
      agentId = principal!.id;
      await tx.insert(agents).values({ id: agentId, tenantId: org.tenantId, workspaceId: ws.id, role: spec.role, name: spec.name, autonomy: spec.autonomy, spec });
    }

    const [current] = await tx.select().from(policies).where(eq(policies.workspaceId, ws.id)).orderBy(desc(policies.version)).limit(1);
    const version = (current?.version ?? 0) + 1;
    const tenantRules = current?.tenantRules ?? [];
    const engine = new PolicyEngine({ version, packRules: pack.policies, tenantRules });
    await tx.insert(policies).values({ tenantId: org.tenantId, workspaceId: ws.id, version, packRules: pack.policies, tenantRules, cedar: engine.cedarText });

    await tx
      .insert(jobSettings)
      .values({ tenantId: org.tenantId, workspaceId: ws.id, jobId: def.id, enabled: true, dailyCap: def.daily_cap })
      .onConflictDoUpdate({ target: [jobSettings.workspaceId, jobSettings.jobId], set: { enabled: true, updatedAt: new Date() } });
    return { agentId, jobId: def.id };
  });
}
