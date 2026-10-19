import { randomBytes } from 'node:crypto';
import { ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JobDefSchema, ORG_TYPES, type JobCard, type JobInput, type PackAgent, type ResolvedPack } from '@onehuman/schemas';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AgentsService } from '../../src/agents/agents.service';
import { AuthGuard, issueToken, MANAGERS_ONLY, type Session } from '../../src/common/auth';
import { DbService } from '../../src/db/db.service';
import { IdentityService } from '../../src/identity/identity.service';
import { JobsController } from '../../src/jobs/jobs.controller';
import { JobsService } from '../../src/jobs/jobs.service';
import { MembersService } from '../../src/members/members.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { createActivities } from '../../src/orchestration/activities';
import { OrchestratorService } from '../../src/orchestration/orchestrator.service';
import { TemporalService } from '../../src/orchestration/temporal.service';
import { OnboardingService } from '../../src/tenancy/onboarding.service';
import { TenancyService } from '../../src/tenancy/tenancy.service';
import { PackRegistry } from '../../src/packs/registry.service';
import { istDate } from '../../src/voice/time';
import { anyIp, boot, newOrg, PASSWORD, uniqueEmail, type Harness, type Org } from './harness';
import { installJobFixture, JOB_TESTER } from './jobs-fixture';

/**
 * Jobs: switching them on and off, the runs a trigger starts, and what stops a
 * run from starting (switched off, paused, the daily cap, the same trigger twice).
 * Temporal is the harness's recorder, so a started run is a goal, its one task
 * and the job run, plus a recorded startGoal.
 */

let h: Harness;
let plant: Org;
let jobs: JobsService;

beforeAll(async () => {
  h = await boot();
  plant = await newOrg(h, 'power-plant');
  jobs = h.get(JobsService);
});
afterAll(() => h.close());
afterEach(() => vi.restoreAllMocks());

const READ_ONLY = [{ read: { as: 'say', from: 'trigger' } }] as JobInput['steps'];
const scheduleJob = (id: string, extra: Partial<JobInput> = {}): JobInput => ({
  id,
  name: 'Morning check',
  description: 'Looks over the day before the shift starts.',
  agent: JOB_TESTER,
  trigger: { schedule: { days: [1, 2, 3, 4, 5, 6], time: '09:00' } },
  steps: READ_ONLY,
  ...extra,
});
const manualJob = (id: string, extra: Partial<JobInput> = {}): JobInput => ({
  id,
  name: 'Answer a question',
  description: 'Answers a question someone types in.',
  agent: JOB_TESTER,
  trigger: { manual: { input: 'Question' } },
  steps: READ_ONLY,
  ...extra,
});

const recorded = (method: string) => h.temporal.filter((t) => t.method === method).map((t) => t.args[0] as Record<string, unknown>);

async function count(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await h.owner.query<{ n: string }>(sql, params);
  return Number(rows[0]!.n);
}

const runsOf = (org: Org, jobId: string) => count(`select count(*) as n from job_runs where workspace_id = $1 and job_id = $2`, [org.workspaceId, jobId]);
const goalsOf = (org: Org) => count(`select count(*) as n from goals where workspace_id = $1`, [org.workspaceId]);

const scheduled = (org: Org, jobId: string, dedupeKey: string) =>
  jobs.startRun(org.tenantId, { workspaceId: org.workspaceId, jobId, trigger: 'schedule', dedupeKey, payload: { date: istDate() }, origin: 'owner' });

describe('switching a job on and off', () => {
  it('keeps its Temporal schedule in step: India time while on, deleted when off', async () => {
    const { jobId } = await installJobFixture(h, plant, scheduleJob('spec-morning'));
    const before = recorded('syncJobSchedule').length;

    const on = await jobs.switch(plant.session, jobId, { enabled: true });
    expect(on).toMatchObject({ id: jobId, enabled: true, trigger: 'schedule', triggerText: 'Every Mon–Sat at 09:00', agentRole: JOB_TESTER, dailyCap: 50 });
    expect(recorded('syncJobSchedule').slice(before)).toEqual([
      { tenantId: plant.tenantId, workspaceId: plant.workspaceId, jobId, days: [1, 2, 3, 4, 5, 6], time: '09:00', active: true },
    ]);

    const off = await jobs.switch(plant.session, jobId, { enabled: false });
    expect(off.enabled).toBe(false);
    expect(recorded('syncJobSchedule').at(-1)).toMatchObject({ jobId, active: false });

    const { rows } = await h.owner.query<{ payload: Record<string, unknown> }>(
      `select payload from audit_events where tenant_id = $1 and type = 'job.switched' and payload->>'jobId' = $2 order by seq`,
      [plant.tenantId, jobId],
    );
    expect(rows.map((r) => r.payload.enabled)).toEqual([true, false]);
    expect((await jobs.list(plant.tenantId)).find((j) => j.id === jobId)).toMatchObject({ enabled: false, lastRun: null });
  });

  it('changes the daily cap, and refuses to switch on a job whose agent has no job card', async () => {
    const org = await newOrg(h, 'power-plant');
    const { jobId } = await installJobFixture(h, org, manualJob('spec-no-card'), { job: undefined });
    await expect(jobs.switch(org.session, jobId, { enabled: true })).rejects.toThrow('This agent has no job card');
    expect((await jobs.switch(org.session, jobId, { dailyCap: 7 })).dailyCap).toBe(7);
    await expect(jobs.switch(org.session, 'no-such-job', { enabled: true })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('Run now', () => {
  it('starts one goal with one task and one run, auto-started, and planning reuses that task', async () => {
    const { jobId, agentId } = await installJobFixture(h, plant, manualJob('spec-ask'));
    const started = await jobs.runNow(plant.session, jobId, { input: 'Is the boiler inspection due?' });
    if (!('runId' in started)) throw new Error(`skipped: ${started.skipped}`);

    const { rows: goalRows } = await h.owner.query<{ text: string; status: string; origin: string; workflow_id: string }>(
      `select text, status, origin, workflow_id from goals where id = $1`,
      [started.goalId],
    );
    expect(goalRows).toEqual([{ text: 'Answer a question: run now', status: 'running', origin: 'owner', workflow_id: `goal-${started.goalId}` }]);
    const { rows: taskRows } = await h.owner.query<{ id: string; key: string; title: string; description: string; agent_id: string }>(
      `select id, key, title, description, agent_id from tasks where goal_id = $1`,
      [started.goalId],
    );
    expect(taskRows).toEqual([
      expect.objectContaining({ key: `job-${jobId}`, title: 'Answer a question', agent_id: agentId, description: expect.stringContaining('Is the boiler inspection due?') }),
    ]);
    const { rows: runRows } = await h.owner.query<{ id: string; task_id: string; trigger: string; input: Record<string, unknown>; status: string }>(
      `select id, task_id, trigger, input, status from job_runs where goal_id = $1`,
      [started.goalId],
    );
    expect(runRows).toEqual([
      { id: started.runId, task_id: taskRows[0]!.id, trigger: 'manual', input: { text: 'Is the boiler inspection due?', by: plant.session.principalId }, status: 'running' },
    ]);
    expect(recorded('startGoal').at(-1)).toEqual({ tenantId: plant.tenantId, goalId: started.goalId, autoStart: true });
    expect(await count(`select count(*) as n from audit_events where type = 'job.run_started' and ref_id = $1`, [started.runId])).toBe(1);

    const plan = await h.get(OrchestratorService).planGoal(plant.tenantId, started.goalId, true);
    expect(plan.tasks).toEqual([{ id: taskRows[0]!.id, key: `job-${jobId}`, dependsOn: [] }]);
    expect(await count(`select count(*) as n from tasks where goal_id = $1`, [started.goalId])).toBe(1);

    const runs = await jobs.runs(plant.tenantId, jobId);
    expect(runs[0]).toMatchObject({ id: started.runId, jobId, trigger: 'manual', status: 'running', goalId: started.goalId, caseId: null, flags: [] });
    expect((await jobs.list(plant.tenantId)).find((j) => j.id === jobId)?.lastRun?.id).toBe(started.runId);
  });

  it('ends the run plainly when its workflow cannot be started, instead of leaving it running', async () => {
    const { jobId } = await installJobFixture(h, plant, manualJob('spec-no-temporal'));
    vi.spyOn(h.get(TemporalService), 'startGoal').mockRejectedValueOnce(new Error('Temporal is down'));
    await expect(jobs.runNow(plant.session, jobId, {})).rejects.toThrow('Temporal is down');
    const [run] = await jobs.runs(plant.tenantId, jobId);
    expect(run).toMatchObject({ status: 'failed', summary: 'The run could not start. Try again in a minute.' });
    const { rows } = await h.owner.query<{ goal: string; task: string }>(
      `select g.status as goal, t.status as task from goals g join tasks t on t.goal_id = g.id where g.id = $1`,
      [run!.goalId],
    );
    expect(rows).toEqual([{ goal: 'failed', task: 'failed' }]);
    expect(await jobs.runNow(plant.session, jobId, {})).toHaveProperty('runId');
  });
});

describe('what stops a run from starting', () => {
  it('starts the same trigger once: a second start with the same key is a duplicate and leaves nothing behind', async () => {
    const { jobId } = await installJobFixture(h, plant, scheduleJob('spec-dedupe'));
    const first = await scheduled(plant, jobId, 'schedule:2026-10-19T09:00');
    expect(first).toHaveProperty('runId');
    const goals = await goalsOf(plant);
    const starts = recorded('startGoal').length;

    expect(await scheduled(plant, jobId, 'schedule:2026-10-19T09:00')).toEqual({ skipped: 'duplicate' });
    expect(await runsOf(plant, jobId)).toBe(1);
    expect(await goalsOf(plant)).toBe(goals);
    expect(recorded('startGoal').length).toBe(starts);
  });

  it('two starts of the same trigger at the same moment start one run', async () => {
    const { jobId } = await installJobFixture(h, plant, scheduleJob('spec-race'));
    const goals = await goalsOf(plant);
    const both = await Promise.all([scheduled(plant, jobId, 'race:1'), scheduled(plant, jobId, 'race:1')]);
    expect(both.filter((r) => 'runId' in r)).toHaveLength(1);
    expect(both).toContainEqual({ skipped: 'duplicate' });

    // A job with no switch row yet (Run now style) has nothing to queue on: the unique key decides, and the loser's goal and task roll back.
    const manual = await installJobFixture(h, plant, manualJob('spec-race-manual'));
    await h.owner.query(`delete from job_settings where workspace_id = $1 and job_id = $2`, [plant.workspaceId, manual.jobId]);
    const start = () =>
      jobs.startRun(plant.tenantId, { workspaceId: plant.workspaceId, jobId: manual.jobId, trigger: 'manual', dedupeKey: 'race:2', payload: {}, origin: 'owner' });
    const pair = await Promise.all([start(), start()]);
    expect(pair.filter((r) => 'runId' in r)).toHaveLength(1);
    expect(pair).toContainEqual({ skipped: 'duplicate' });

    expect(await runsOf(plant, jobId)).toBe(1);
    expect(await runsOf(plant, manual.jobId)).toBe(1);
    expect(await goalsOf(plant)).toBe(goals + 2);
    expect(await count(`select count(*) as n from tasks t join goals g on g.id = t.goal_id where g.workspace_id = $1 and t.key = $2`, [plant.workspaceId, `job-${manual.jobId}`])).toBe(1);
  });

  it('a retried schedule activity starts one run for the tick', async () => {
    const { jobId } = await installJobFixture(h, plant, scheduleJob('spec-tick'));
    const activities = createActivities({ get: (t: unknown) => h.get(t as never) } as never);
    const input = { tenantId: plant.tenantId, workspaceId: plant.workspaceId, jobId };
    const first = await activities.startScheduledJob(input);
    expect(first).toHaveProperty('runId');
    expect(await activities.startScheduledJob(input)).toEqual({ skipped: 'duplicate' });
    const { rows } = await h.owner.query<{ dedupe_key: string; input: Record<string, unknown> }>(
      `select dedupe_key, input from job_runs where workspace_id = $1 and job_id = $2`,
      [plant.workspaceId, jobId],
    );
    expect(rows).toEqual([{ dedupe_key: `schedule:${istDate()}T09:00`, input: { date: istDate() } }]);
  });

  it('stops at the daily cap and tells the owner once a day', async () => {
    const { jobId } = await installJobFixture(h, plant, scheduleJob('spec-capped', { name: 'Capped check', daily_cap: 1 }));
    const push = vi.spyOn(h.get(NotificationsService), 'pushToManagers').mockResolvedValue();

    expect(await scheduled(plant, jobId, 'cap:1')).toHaveProperty('runId');
    expect(await scheduled(plant, jobId, 'cap:2')).toEqual({ skipped: 'cap' });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(plant.tenantId, expect.objectContaining({ body: 'Capped check reached its daily limit of 1 run' }));
    expect(await scheduled(plant, jobId, 'cap:3')).toEqual({ skipped: 'cap' });
    expect(push).toHaveBeenCalledTimes(1);

    expect(await runsOf(plant, jobId)).toBe(1);
    expect(
      await count(`select count(*) as n from audit_events where tenant_id = $1 and type = 'job.switched' and payload->>'jobId' = $2 and payload->>'cap' = 'true'`, [
        plant.tenantId,
        jobId,
      ]),
    ).toBe(1);
  });

  it('starts nothing while the agent, the workspace or the company is paused', async () => {
    const org = await newOrg(h, 'power-plant');
    const { jobId, agentId } = await installJobFixture(h, org, scheduleJob('spec-paused'));

    await h.get(AgentsService).setPaused(org.session, agentId, true);
    expect(await scheduled(org, jobId, 'paused:1')).toEqual({ skipped: 'paused' });
    expect(await jobs.runNow(org.session, jobId, {})).toEqual({ skipped: 'paused' });
    await h.get(AgentsService).setPaused(org.session, agentId, false);

    const tenancy = h.get(TenancyService);
    await tenancy.setWorkspacePaused(org.session, org.workspaceId, true);
    expect(await scheduled(org, jobId, 'paused:2')).toEqual({ skipped: 'paused' });
    await tenancy.setWorkspacePaused(org.session, org.workspaceId, false);

    await tenancy.setTenantPaused(org.session, true);
    expect(await scheduled(org, jobId, 'paused:3')).toEqual({ skipped: 'paused' });
    await tenancy.setTenantPaused(org.session, false);

    expect(await runsOf(org, jobId)).toBe(0);
    expect(await scheduled(org, jobId, 'paused:4')).toHaveProperty('runId');
  });

  it('a switched-off job does not start on its schedule, but Run now still runs it', async () => {
    const { jobId } = await installJobFixture(h, plant, scheduleJob('spec-off'));
    await jobs.switch(plant.session, jobId, { enabled: false });
    const activities = createActivities({ get: (t: unknown) => h.get(t as never) } as never);
    expect(await activities.startScheduledJob({ tenantId: plant.tenantId, workspaceId: plant.workspaceId, jobId })).toEqual({ skipped: 'off' });
    expect(await scheduled(plant, jobId, 'off:1')).toEqual({ skipped: 'off' });
    const now = await jobs.runNow(plant.session, jobId, {});
    expect(now).toHaveProperty('runId');
    expect(await runsOf(plant, jobId)).toBe(1);
  });
});

describe('who may switch and run jobs', () => {
  const contextFor = (token: string, handler: (...args: never[]) => unknown, method: string): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => JobsController,
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` }, method, query: {} }) }),
    }) as unknown as ExecutionContext;

  it('turns a member away from switching (403) and running, but lets them see the jobs', async () => {
    // As lists.spec.ts checks ListsController, plus the real guard on a member's session.
    expect(Reflect.getMetadata(MANAGERS_ONLY, JobsController.prototype.switch)).toBe(true);
    expect(Reflect.getMetadata(MANAGERS_ONLY, JobsController.prototype.run)).toBe(true);
    expect(Reflect.getMetadata(MANAGERS_ONLY, JobsController.prototype.list)).toBeUndefined();

    const members = h.get(MembersService);
    const made = await members.invite(plant.session, { name: 'Meena Member', email: uniqueEmail('meena'), role: 'member', approverRoles: [] });
    const member = await members.accept(plant.tenantId, made.path.split('/').pop()!, { password: PASSWORD, name: 'Meena Member' }, anyIp());
    const guard = new AuthGuard(new Reflector(), h.get(DbService));

    await expect(guard.canActivate(contextFor(member.token, JobsController.prototype.switch, 'PATCH'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(contextFor(member.token, JobsController.prototype.run, 'POST'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(contextFor(member.token, JobsController.prototype.list, 'GET'))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(issueToken(plant.session), JobsController.prototype.switch, 'PATCH'))).resolves.toBe(true);
  });
});

describe('jobs and job cards from the base packs', () => {
  it('the update banner gives agents saved without a job card the pack card, and leaves an edited card alone', async () => {
    const org = await newOrg(h, 'power-plant');
    await h.owner.query(
      `update workspaces set pack = jsonb_set(pack, '{agents}', (select jsonb_agg(a - 'job') from jsonb_array_elements(pack->'agents') a)) where id = $1`,
      [org.workspaceId],
    );
    await h.owner.query(`update agents set spec = spec - 'job' where workspace_id = $1`, [org.workspaceId]);
    const { rows: before } = await h.owner.query<{ id: string; role: string }>(`select id, role from agents where workspace_id = $1 order by role`, [org.workspaceId]);
    const edited = before[0]!;
    const card: JobCard = { mission: 'Edited by the owner.', never: [], customer_facing: false, escalate: [], forbid: [], trial_days: 14, metrics: [] };
    await h.owner.query(`update agents set spec = jsonb_set(spec, '{job}', $2::jsonb) where id = $1`, [edited.id, JSON.stringify(card)]);

    const onboarding = h.get(OnboardingService);
    const offered = await onboarding.updates(org.tenantId, org.workspaceId);
    expect(offered.jobCards?.length).toBe(before.length);
    await onboarding.applyUpdates(org.session, org.workspaceId);

    const { rows: ws } = await h.owner.query<{ pack: ResolvedPack }>(`select pack from workspaces where id = $1`, [org.workspaceId]);
    const latest = new Map(ws[0]!.pack.agents.map((a) => [a.role, a.job]));
    const { rows: after } = await h.owner.query<{ id: string; role: string; spec: PackAgent }>(`select id, role, spec from agents where workspace_id = $1`, [org.workspaceId]);
    for (const a of after) {
      if (a.id === edited.id) expect(a.spec.job).toEqual(card);
      else {
        expect(a.spec.job?.mission).toBeTruthy();
        expect(a.spec.job).toEqual(latest.get(a.role));
      }
    }
    const { rows: audit } = await h.owner.query<{ payload: Record<string, unknown> }>(
      `select payload from audit_events where tenant_id = $1 and type = 'pack.updated' order by seq desc limit 1`,
      [org.tenantId],
    );
    expect((audit[0]!.payload.jobCards as string[]).sort()).toEqual(after.filter((a) => a.id !== edited.id).map((a) => a.role).sort());
  });

  it('a job the update banner adds arrives switched off', async () => {
    const org = await newOrg(h, 'power-plant');
    const { rows } = await h.owner.query<{ pack: ResolvedPack }>(`select pack from workspaces where id = $1`, [org.workspaceId]);
    const role = rows[0]!.pack.agents.find((a) => a.job)!.role;
    const registry = h.get(PackRegistry);
    const real = registry.latestFor.bind(registry);
    const added = JobDefSchema.parse({ ...manualJob('spec-from-update'), agent: role });
    vi.spyOn(registry, 'latestFor').mockImplementation((installed) => {
      const latest = real(installed)!;
      return { ...latest, jobs: [...(latest.jobs ?? []), added] };
    });
    const before = recorded('syncJobSchedule').length;
    await h.get(OnboardingService).applyUpdates(org.session, org.workspaceId);
    expect((await jobs.list(org.tenantId)).map((j) => ({ id: j.id, enabled: j.enabled }))).toEqual([{ id: 'spec-from-update', enabled: false }]);
    expect(await jobs.startRun(org.tenantId, { workspaceId: org.workspaceId, jobId: 'spec-from-update', trigger: 'schedule', dedupeKey: 'x', payload: {}, origin: 'owner' })).toEqual({
      skipped: 'off',
    });
    expect(recorded('syncJobSchedule').length).toBe(before);
  });

  it("a new install switches every job of the pack on and schedules the scheduled ones", async () => {
    const type = ORG_TYPES.find((t) => t.id === 'power-plant')!;
    const auth = await h.get(IdentityService).signup(
      { companyName: `Spec jobs ${randomBytes(2).toString('hex')}`, ownerName: 'Asha Owner', email: uniqueEmail('owner'), password: PASSWORD, sector: type.sector, orgType: type.id },
      anyIp(),
    );
    const session: Session = { userId: auth.user.userId, principalId: auth.user.principalId, tenantId: auth.tenant.id, role: 'owner' };
    const onboarding = h.get(OnboardingService);
    const draft = await onboarding.preview(session, {});
    const agent: PackAgent = {
      ...draft.pack.agents[0]!,
      role: JOB_TESTER,
      name: 'Job tester',
      job: { mission: 'Checks the plant every morning.', never: [], customer_facing: false, escalate: [], forbid: [], trial_days: 14, metrics: [] },
    };
    const pack: ResolvedPack = { ...draft.pack, agents: [...draft.pack.agents, agent], jobs: [JobDefSchema.parse(scheduleJob('spec-installed'))] };
    await h.owner.query(`update pack_drafts set pack = $2::jsonb where id = $1`, [draft.id, JSON.stringify(pack)]);

    const ws = await onboarding.install(session, draft.id, false);
    const { rows } = await h.owner.query<{ job_id: string; enabled: boolean; daily_cap: number }>(`select job_id, enabled, daily_cap from job_settings where workspace_id = $1`, [ws.id]);
    expect(rows).toEqual([{ job_id: 'spec-installed', enabled: true, daily_cap: 50 }]);
    expect(recorded('syncJobSchedule').at(-1)).toEqual({ tenantId: session.tenantId, workspaceId: ws.id, jobId: 'spec-installed', days: [1, 2, 3, 4, 5, 6], time: '09:00', active: true });
    expect((await jobs.list(session.tenantId)).map((j) => ({ id: j.id, enabled: j.enabled }))).toEqual([{ id: 'spec-installed', enabled: true }]);
  });
});
