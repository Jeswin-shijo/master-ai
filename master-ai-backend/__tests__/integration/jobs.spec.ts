import { randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, NotFoundException, type ExecutionContext, type PipeTransform } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import {
  JobDefSchema,
  ORG_TYPES,
  type AgentView,
  type JobCard,
  type JobCardEdit,
  type JobInput,
  type PackAgent,
  type ResolvedPack,
  type RunJobInput,
} from '@onehuman/schemas';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AgentsService } from '../../src/agents/agents.service';
import { CasesService } from '../../src/cases/cases.service';
import { CaseStagesService } from '../../src/cases/stages.service';
import { AuthGuard, issueToken, MANAGERS_ONLY, type Session } from '../../src/common/auth';
import { DbService } from '../../src/db/db.service';
import { cases as casesTable } from '../../src/db/schema';
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
import { RecordsService } from '../../src/records/records.service';
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

  it('runs with no request body at all: Express 5 leaves the body undefined, and that is no text, not a 400', async () => {
    const { jobId } = await installJobFixture(h, plant, manualJob('spec-no-body'));
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, JobsController, 'run') as Record<string, { pipes: PipeTransform[] }>;
    const pipes = Object.entries(args).find(([key]) => key.startsWith(`${RouteParamtypes.BODY}:`))![1].pipes;
    const body = pipes.reduce<unknown>((value, pipe) => pipe.transform(value, { type: 'body' }), undefined) as RunJobInput;
    expect(body).toEqual({});

    const started = await h.get(JobsController).run(plant.session, jobId, body);
    if (!('runId' in started)) throw new Error(`skipped: ${started.skipped}`);
    const { rows } = await h.owner.query<{ input: Record<string, unknown> }>(`select input from job_runs where id = $1`, [started.runId]);
    expect(rows[0]!.input).toEqual({ text: null, by: plant.session.principalId });
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

  it('an install with sample data starts nothing on its first sweep: the mark lies after the rows the install seeded', async () => {
    const type = ORG_TYPES.find((t) => t.id === 'power-plant')!;
    const auth = await h.get(IdentityService).signup(
      { companyName: `Spec sweep ${randomBytes(2).toString('hex')}`, ownerName: 'Asha Owner', email: uniqueEmail('owner'), password: PASSWORD, sector: type.sector, orgType: type.id },
      anyIp(),
    );
    const session: Session = { userId: auth.user.userId, principalId: auth.user.principalId, tenantId: auth.tenant.id, role: 'owner' };
    const onboarding = h.get(OnboardingService);
    const draft = await onboarding.preview(session, {});
    const agent: PackAgent = {
      ...draft.pack.agents[0]!,
      role: JOB_TESTER,
      name: 'Job tester',
      job: { mission: 'Watches the plant.', never: [], customer_facing: false, escalate: [], forbid: [], trial_days: 14, metrics: [] },
    };
    const defs = [JobDefSchema.parse({ ...recordJob('spec-installed-created', 'created'), agent: JOB_TESTER }), JobDefSchema.parse({ ...listJob('spec-installed-list'), agent: JOB_TESTER })];
    const pack: ResolvedPack = { ...draft.pack, agents: [...draft.pack.agents, agent], jobs: defs };
    await h.owner.query(`update pack_drafts set pack = $2::jsonb where id = $1`, [draft.id, JSON.stringify(pack)]);

    const ws = await onboarding.install(session, draft.id, true);
    const { rows: seeded } = await h.owner.query<{ n: string; late: string }>(
      `select count(*) as n, count(*) filter (where r.created_at >= js.swept_at or r.updated_at >= js.swept_at) as late
       from records r, job_settings js where r.workspace_id = $1 and js.workspace_id = $1 and r.entity = 'Equipment'`,
      [ws.id],
    );
    expect(Number(seeded[0]!.n)).toBeGreaterThan(0);
    expect(Number(seeded[0]!.late)).toBe(0);

    expect(await jobs.sweep(session.tenantId)).toEqual({ started: 0 });
    expect(await count(`select count(*) as n from job_runs where workspace_id = $1`, [ws.id])).toBe(0);
  });
});

// ---------- Task 10: request triggers and the list and record sweep ----------

const PM_TEXT = 'Quarterly lubrication and greasing of boiler feed pump BFP-2 is due as per the PM schedule.';
const requestJob = (id: string, categories: string[], at: 'arrival' | 'execute', extra: Partial<JobInput> = {}): JobInput => ({
  id,
  name: 'Answer the request',
  description: 'Works on a request as soon as it fits.',
  agent: JOB_TESTER,
  trigger: { request: { categories, at } },
  steps: READ_ONLY,
  ...extra,
});
const listJob = (id: string, extra: Partial<JobInput> = {}): JobInput => ({
  id,
  name: 'Maintenance reminder',
  description: 'Reminds the crew when equipment is past its maintenance date.',
  agent: JOB_TESTER,
  trigger: { list: { list: 'equipment', due: { overdue: { date: 'nextMaintenance' } } } },
  steps: READ_ONLY,
  ...extra,
});
const recordJob = (id: string, on: 'created' | 'updated' | 'either', extra: Partial<JobInput> = {}): JobInput => ({
  id,
  name: 'Equipment watch',
  description: 'Looks at equipment whenever it changes.',
  agent: JOB_TESTER,
  trigger: { record: { entity: 'Equipment', on } },
  steps: READ_ONLY,
  ...extra,
});

/** A day in India `offset` days from today. */
const day = (offset: number) => istDate(new Date(Date.now() + offset * 86_400_000));

async function caseRow(org: Org, id: string) {
  const [row] = await h.get(DbService).tenant(org.tenantId, (tx) => tx.select().from(casesTable).where(eq(casesTable.id, id)));
  return row!;
}

async function equipment(org: Org) {
  const { rows } = await h.owner.query<{ id: string; data: Record<string, unknown> }>(
    `select id, data from records where workspace_id = $1 and entity = 'Equipment' order by created_at, id`,
    [org.workspaceId],
  );
  return rows;
}

/** Three real (manual) equipment records, made through RecordsService.create from the sample data. */
async function realEquipment(org: Org) {
  const records = h.get(RecordsService);
  const [sample] = await equipment(org);
  const tag = randomBytes(2).toString('hex');
  await h.get(DbService).tenant(org.tenantId, async (tx) => {
    const ws = await records.activeWorkspace(tx, org.workspaceId);
    for (let i = 1; i <= 3; i++) {
      await records.create(tx, org.tenantId, ws, 'Equipment', { ...sample!.data, tag: `R-${tag}-${i}`, name: `Real pump ${i}`, nextMaintenance: day(30) }, { id: org.session.principalId, kind: 'human' });
    }
  });
  const { rows } = await h.owner.query<{ id: string; data: Record<string, unknown> }>(
    `select id, data from records where workspace_id = $1 and entity = 'Equipment' and source <> 'sample' order by created_at, id`,
    [org.workspaceId],
  );
  return rows;
}

/** Change a record the one way records change: RecordsService.update, audited. */
async function updateEquipment(org: Org, id: string, patch: Record<string, unknown>) {
  const records = h.get(RecordsService);
  await h.get(DbService).tenant(org.tenantId, async (tx) => {
    const ws = await records.activeWorkspace(tx, org.workspaceId);
    await records.update(tx, org.tenantId, ws, 'Equipment', id, patch, { actor: { id: org.session.principalId, kind: 'human' }, via: 'manual' });
  });
}

async function runRows(org: Org, jobId: string) {
  const { rows } = await h.owner.query<{ id: string; dedupe_key: string; input: Record<string, unknown>; trigger: string; case_id: string | null; goal_id: string; task_id: string }>(
    `select id, dedupe_key, input, trigger, case_id, goal_id, task_id from job_runs where workspace_id = $1 and job_id = $2 order by created_at, dedupe_key`,
    [org.workspaceId, jobId],
  );
  return rows;
}

describe('request jobs', () => {
  it('a case reaching Execute in the job category runs the job as the goal one task, and planning reuses it', async () => {
    const org = await newOrg(h, 'power-plant');
    const stages = h.get(CaseStagesService);
    const { jobId, agentId } = await installJobFixture(h, org, requestJob('spec-pm', ['planned-maintenance'], 'execute', { name: 'Plan the maintenance' }));
    // A second job for the same category: one job per case, the first by pack order.
    await installJobFixture(h, org, requestJob('spec-pm-second', ['any'], 'execute'));

    const c = await h.get(CasesService).create(org.session, { text: PM_TEXT });
    const at = (stage: 'request' | 'review' | 'classify' | 'assign' | 'execute', attempt = 1) => ({ tenantId: org.tenantId, caseId: c.id, stage, attempt });
    for (const stage of ['request', 'review', 'classify', 'assign'] as const) {
      await stages.beginStage(at(stage));
      expect(await stages.runStage(at(stage)), stage).toEqual({ outcome: 'done' });
    }
    expect((await caseRow(org, c.id)).category).toBe('planned-maintenance');

    await stages.beginStage(at('execute'));
    const started = await stages.startExecution(at('execute'));
    const { rows: taskRows } = await h.owner.query<{ id: string; key: string; agent_id: string }>(`select id, key, agent_id from tasks where goal_id = $1`, [started.goalId]);
    expect(taskRows).toEqual([{ id: expect.any(String), key: `job-${jobId}`, agent_id: agentId }]);
    expect(await runRows(org, jobId)).toEqual([
      {
        id: expect.any(String),
        dedupe_key: `case:${c.id}:1`,
        input: { code: c.code, title: c.title, text: PM_TEXT, from: 'Asha Owner' },
        trigger: 'request',
        case_id: c.id,
        goal_id: started.goalId,
        task_id: taskRows[0]!.id,
      },
    ]);
    expect(await runsOf(org, 'spec-pm-second')).toBe(0);
    const { rows: goalRows } = await h.owner.query<{ case_id: string; status: string; origin: string }>(`select case_id, status, origin from goals where id = $1`, [started.goalId]);
    expect(goalRows).toEqual([{ case_id: c.id, status: 'running', origin: 'owner' }]);
    // The case workflow starts the goal as its child: no goal of its own is started.
    expect(recorded('startGoal').some((g) => g.goalId === started.goalId)).toBe(false);

    const plan = await h.get(OrchestratorService).planGoal(org.tenantId, started.goalId, true);
    expect(plan.tasks).toEqual([{ id: taskRows[0]!.id, key: `job-${jobId}`, dependsOn: [] }]);

    // A retried activity finds the goal it started.
    expect(await stages.startExecution(at('execute'))).toEqual(started);
    expect(await runsOf(org, jobId)).toBe(1);

    // Rework (attempt 2): a new goal and a new run, with the reason the first result was not accepted.
    const rework = { ...at('execute', 2), reworkNote: 'Greased, but the oil was not topped up.' };
    await stages.beginStage(rework);
    const second = await stages.startExecution(rework);
    expect(second.goalId).not.toBe(started.goalId);
    const runs = await runRows(org, jobId);
    expect(runs.map((r) => r.dedupe_key)).toEqual([`case:${c.id}:1`, `case:${c.id}:2`]);
    expect(runs[1]).toMatchObject({ goal_id: second.goalId, input: { code: c.code, note: 'Greased, but the oil was not topped up.' } });
  });

  it('a switched-off execute job leaves the case goal to the planner', async () => {
    const org = await newOrg(h, 'power-plant');
    const stages = h.get(CaseStagesService);
    const { jobId } = await installJobFixture(h, org, requestJob('spec-pm-off', ['planned-maintenance'], 'execute'));
    await jobs.switch(org.session, jobId, { enabled: false });
    const c = await h.get(CasesService).create(org.session, { text: PM_TEXT });
    const at = (stage: 'request' | 'review' | 'classify' | 'assign' | 'execute') => ({ tenantId: org.tenantId, caseId: c.id, stage, attempt: 1 });
    for (const stage of ['request', 'review', 'classify', 'assign'] as const) {
      await stages.beginStage(at(stage));
      await stages.runStage(at(stage));
    }
    await stages.beginStage(at('execute'));
    const started = await stages.startExecution(at('execute'));
    expect(await count(`select count(*) as n from tasks where goal_id = $1`, [started.goalId])).toBe(0);
    expect(await runsOf(org, jobId)).toBe(0);
  });

  it('a request arriving starts its arrival jobs (any, or its category) once per case, each in a goal of its own', async () => {
    const org = await newOrg(h, 'power-plant');
    const first = await installJobFixture(h, org, requestJob('spec-first-reply', ['any'], 'arrival', { name: 'First reply' }));
    const pm = await installJobFixture(h, org, requestJob('spec-pm-arrival', ['planned-maintenance'], 'arrival'));
    const accident = await installJobFixture(h, org, requestJob('spec-accident-arrival', ['accident'], 'arrival'));
    const later = await installJobFixture(h, org, requestJob('spec-pm-later', ['planned-maintenance'], 'execute'));

    const c = await h.get(CasesService).create(org.session, { text: PM_TEXT });
    const [run] = await runRows(org, first.jobId);
    expect(run).toMatchObject({ dedupe_key: `arrival:${c.id}`, trigger: 'request', case_id: c.id, input: { code: c.code, title: c.title, text: PM_TEXT, from: 'Asha Owner' } });
    const { rows: goalRows } = await h.owner.query<{ case_id: string | null; status: string; origin: string; text: string }>(`select case_id, status, origin, text from goals where id = $1`, [run!.goal_id]);
    expect(goalRows).toEqual([{ case_id: null, status: 'running', origin: 'owner', text: `First reply: request ${c.code}` }]);
    expect(recorded('startGoal')).toContainEqual({ tenantId: org.tenantId, goalId: run!.goal_id, autoStart: true });
    expect(await runsOf(org, pm.jobId)).toBe(1);
    expect(await runsOf(org, accident.jobId)).toBe(0);
    expect(await runsOf(org, later.jobId)).toBe(0);

    // Again for the same case: nothing new.
    const again = await jobs.startArrivalRuns(org.tenantId, await caseRow(org, c.id));
    expect(again.map((r) => r.result)).toEqual([{ skipped: 'duplicate' }, { skipped: 'duplicate' }]);
    expect(await runsOf(org, first.jobId)).toBe(1);
    expect(await runsOf(org, pm.jobId)).toBe(1);

    // A customer's words: the run's goal is inbound, so the untrusted-origin rules apply to what it does.
    const { row } = await h.get(CasesService).open(org.tenantId, {
      source: 'customer',
      requester: { name: 'Ravi Kumar', phone: '+91 98450 12345' },
      text: 'The street light outside house 14 has been off for three days.',
      createdBy: null,
      actor: { id: org.session.principalId, kind: 'human' },
    });
    const customerRun = (await runRows(org, first.jobId)).find((r) => r.case_id === row.id)!;
    expect(customerRun.input).toMatchObject({ from: 'Ravi Kumar', text: 'The street light outside house 14 has been off for three days.' });
    expect(await count(`select count(*) as n from goals where id = $1 and origin = 'inbound'`, [customerRun.goal_id])).toBe(1);
    expect(await runsOf(org, pm.jobId)).toBe(1);
  });
});

describe('the list and record sweep', () => {
  it('starts nothing for sample items and sample records', async () => {
    const org = await newOrg(h, 'power-plant');
    const list = await installJobFixture(h, org, listJob('spec-sample-list'));
    const watch = await installJobFixture(h, org, recordJob('spec-sample-watch', 'either'));
    const samples = await equipment(org);
    expect(samples.length).toBeGreaterThan(0);
    await h.owner.query(`update records set source = 'sample' where workspace_id = $1 and entity = 'Equipment'`, [org.workspaceId]);
    await h.owner.query(`update records set created_at = now(), updated_at = now(), data = jsonb_set(data, '{nextMaintenance}', to_jsonb($2::text)) where workspace_id = $1 and entity = 'Equipment'`, [org.workspaceId, day(-4)]);
    await jobs.sweep(org.tenantId);
    expect(await runsOf(org, list.jobId)).toBe(0);
    expect(await runsOf(org, watch.jobId)).toBe(0);
  });

  it('starts one run per due list item, once per due date', async () => {
    const org = await newOrg(h, 'power-plant');
    const [a, b, notDue] = await realEquipment(org);
    const { jobId } = await installJobFixture(h, org, listJob('spec-pm-due'));
    await updateEquipment(org, a!.id, { nextMaintenance: day(-5) });
    await updateEquipment(org, b!.id, { nextMaintenance: day(-2) });

    await jobs.sweep(org.tenantId);
    const runs = await runRows(org, jobId);
    expect(runs.map((r) => r.dedupe_key).sort()).toEqual([`item:${a!.id}:${day(-5)}`, `item:${b!.id}:${day(-2)}`].sort());
    const forA = runs.find((r) => r.dedupe_key.startsWith(`item:${a!.id}`))!;
    expect(forA).toMatchObject({ trigger: 'list', case_id: null, input: { item: { id: a!.id, nextMaintenance: day(-5), tag: a!.data.tag } } });
    expect(runs.some((r) => r.dedupe_key.includes(notDue!.id))).toBe(false);

    await jobs.sweep(org.tenantId);
    expect(await runsOf(org, jobId)).toBe(2);

    // A new due date is a new reason to run.
    await updateEquipment(org, a!.id, { nextMaintenance: day(-1) });
    await jobs.sweep(org.tenantId);
    expect((await runRows(org, jobId)).map((r) => r.dedupe_key)).toContain(`item:${a!.id}:${day(-1)}`);
    expect(await runsOf(org, jobId)).toBe(3);

    const { rows } = await h.owner.query<{ swept_at: Date | null }>(`select swept_at from job_settings where workspace_id = $1 and job_id = $2`, [org.workspaceId, jobId]);
    expect(rows[0]!.swept_at).not.toBeNull();
  });

  it('starts one run per record change, and nothing when nothing changed', async () => {
    const org = await newOrg(h, 'power-plant');
    const [a] = await realEquipment(org);
    const { jobId } = await installJobFixture(h, org, recordJob('spec-watch', 'updated'));

    // Sample records made before the job was on are not changes.
    await jobs.sweep(org.tenantId);
    expect(await runsOf(org, jobId)).toBe(0);

    await updateEquipment(org, a!.id, { location: 'Unit 2 boiler house' });
    await jobs.sweep(org.tenantId);
    const runs = await runRows(org, jobId);
    const { rows: rec } = await h.owner.query<{ updated_at: Date }>(`select updated_at from records where id = $1`, [a!.id]);
    expect(runs).toEqual([expect.objectContaining({ dedupe_key: `record:${a!.id}:${rec[0]!.updated_at.toISOString()}`, trigger: 'record' })]);
    expect(runs[0]!.input).toMatchObject({ record: { id: a!.id, location: 'Unit 2 boiler house' } });

    await jobs.sweep(org.tenantId);
    expect(await runsOf(org, jobId)).toBe(1);

    await updateEquipment(org, a!.id, { location: 'Unit 3 boiler house' });
    await jobs.sweep(org.tenantId);
    expect(await runsOf(org, jobId)).toBe(2);
  });

  it('a record job on created starts for new records only', async () => {
    const org = await newOrg(h, 'power-plant');
    const [a] = await realEquipment(org);
    const { jobId } = await installJobFixture(h, org, recordJob('spec-new-equipment', 'created'));
    await updateEquipment(org, a!.id, { location: 'Moved' });
    const records = h.get(RecordsService);
    const made = await h.get(DbService).tenant(org.tenantId, async (tx) => {
      const ws = await records.activeWorkspace(tx, org.workspaceId);
      return records.create(tx, org.tenantId, ws, 'Equipment', { ...a!.data, tag: 'BFP-9', name: 'Boiler feed pump 9' }, { id: org.session.principalId, kind: 'human' });
    });
    await jobs.sweep(org.tenantId);
    expect((await runRows(org, jobId)).map((r) => r.dedupe_key)).toEqual([`record:${made.id}:${made.createdAt.toISOString()}`]);
  });

  it('changes past the daily cap wait for a later sweep instead of being lost', async () => {
    const org = await newOrg(h, 'power-plant');
    const [a, b] = await realEquipment(org);
    const { jobId } = await installJobFixture(h, org, recordJob('spec-capped-watch', 'either', { daily_cap: 1 }));
    vi.spyOn(h.get(NotificationsService), 'pushToManagers').mockResolvedValue();
    await updateEquipment(org, a!.id, { location: 'Bay 1' });
    await updateEquipment(org, b!.id, { location: 'Bay 2' });

    await jobs.sweep(org.tenantId);
    expect((await runRows(org, jobId)).map((r) => r.dedupe_key)).toEqual([expect.stringContaining(`record:${a!.id}:`)]);
    await jobs.switch(org.session, jobId, { dailyCap: 5 });
    await jobs.sweep(org.tenantId);
    expect((await runRows(org, jobId)).map((r) => r.dedupe_key.split(':')[1])).toEqual([a!.id, b!.id]);
  });

  it('starts nothing while the company is paused, and catches up once it is resumed', async () => {
    const org = await newOrg(h, 'power-plant');
    const [a] = await realEquipment(org);
    const list = await installJobFixture(h, org, listJob('spec-paused-list'));
    const watch = await installJobFixture(h, org, recordJob('spec-paused-watch', 'updated'));
    await updateEquipment(org, a!.id, { nextMaintenance: day(-3) });

    const tenancy = h.get(TenancyService);
    await tenancy.setTenantPaused(org.session, true);
    const activities = createActivities({ get: (t: unknown) => h.get(t as never) } as never);
    await activities.sweepJobs({ tenantId: org.tenantId });
    expect(await runsOf(org, list.jobId)).toBe(0);
    expect(await runsOf(org, watch.jobId)).toBe(0);

    await tenancy.setTenantPaused(org.session, false);
    await activities.sweepJobs({ tenantId: org.tenantId });
    expect(await runsOf(org, list.jobId)).toBe(1);
    expect(await runsOf(org, watch.jobId)).toBe(1);
  });

  it('keeps the 10-minute sweep in step with the list and record jobs that are on', async () => {
    const org = await newOrg(h, 'power-plant');
    const list = await installJobFixture(h, org, listJob('spec-sweep-list'));
    await h.owner.query(`update job_settings set enabled = false where workspace_id = $1`, [org.workspaceId]);
    const sweeps = () => recorded('syncJobSweep').filter((s) => s.tenantId === org.tenantId);

    await jobs.switch(org.session, list.jobId, { enabled: true });
    expect(sweeps()).toEqual([{ tenantId: org.tenantId, active: true }]);
    await jobs.switch(org.session, list.jobId, { enabled: false });
    expect(sweeps().at(-1)).toEqual({ tenantId: org.tenantId, active: false });

    // Another list or record job still on keeps the sweep.
    const watch = await installJobFixture(h, org, recordJob('spec-sweep-watch', 'either'));
    await jobs.switch(org.session, list.jobId, { enabled: true });
    await jobs.switch(org.session, list.jobId, { enabled: false });
    expect(sweeps().at(-1)).toEqual({ tenantId: org.tenantId, active: true });
    await jobs.switch(org.session, watch.jobId, { enabled: false });
    expect(sweeps().at(-1)).toEqual({ tenantId: org.tenantId, active: false });

    // Scheduled jobs have their own schedule.
    const before = sweeps().length;
    const morning = await installJobFixture(h, org, scheduleJob('spec-sweep-morning'));
    await jobs.switch(org.session, morning.jobId, { enabled: false });
    expect(sweeps().length).toBe(before);
  });

  it('a record job switched back on does not run for what changed while it was off', async () => {
    const org = await newOrg(h, 'power-plant');
    const [a] = await realEquipment(org);
    const { jobId } = await installJobFixture(h, org, recordJob('spec-off-watch', 'either'));
    await jobs.switch(org.session, jobId, { enabled: false });
    await updateEquipment(org, a!.id, { location: 'Changed while off' });
    await jobs.sweep(org.tenantId);
    await jobs.switch(org.session, jobId, { enabled: true });
    await jobs.sweep(org.tenantId);
    expect(await runsOf(org, jobId)).toBe(0);

    await updateEquipment(org, a!.id, { location: 'Changed while on' });
    await jobs.sweep(org.tenantId);
    expect(await runsOf(org, jobId)).toBe(1);
  });
});

// ---------- Task 12: the job card on the Agents page ----------

describe('the job card owners read and edit', () => {
  const PACK_SET_KEPT = "A safety word set that came with the pack can't be removed or shortened";
  const agentsService = () => h.get(AgentsService);
  const agentOf = async (org: Org, role: string): Promise<AgentView> => (await agentsService().list(org.tenantId)).find((a) => a.role === role)!;
  /** The card's sets as the Agents page sends them back. */
  const editable = (view: AgentView): NonNullable<JobCardEdit['escalate']> =>
    view.job!.escalations.map(({ id, label, words, alert, reply }) => ({ id, label, words, alert, ...(reply && { reply }) }));
  const storedCard = async (agentId: string): Promise<JobCard | undefined> =>
    (await h.owner.query<{ spec: PackAgent }>(`select spec from agents where id = $1`, [agentId])).rows[0]!.spec.job;
  const cardAudits = (agentId: string) =>
    h.owner
      .query<{ payload: Record<string, unknown> }>(`select payload from audit_events where type = 'agent.job_card_updated' and ref_id = $1 order by seq`, [agentId])
      .then((r) => r.rows.map((row) => row.payload));

  it('lists each card with the shared sets marked inherited, what it may do, and the jobs its agent runs', async () => {
    const org = await newOrg(h, 'power-plant');
    const desk = await agentOf(org, 'consumer-desk');
    expect(desk.job).toMatchObject({
      mission: 'Register supply complaints and connection applications, keep consumers updated and send the line crew by phone.',
      customerFacing: true,
      never: expect.arrayContaining(['Grid switching', 'Electrical safety decisions']),
      may: desk.tools,
      forbidden: [],
    });
    expect(desk.job!.escalations.map((e) => [e.id, e.inherited, e.fromPack])).toEqual([
      ['emergency', true, true],
      ['distress', true, true],
      ['anger', true, true],
      ['legal-threat', true, true],
      ['secrets', true, true],
    ]);
    expect(desk.job!.escalations[0]).toMatchObject({ label: 'Emergencies', alert: 'owner', reply: expect.stringContaining('112'), words: expect.arrayContaining(['gas leak', 'on fire', 'आग']) });
    expect(desk.jobs).toEqual([]);

    // An internal desk inherits none of the customer sets and keeps its own pack set.
    const safety = await agentOf(org, 'safety-desk');
    expect(safety.job!.escalations).toEqual([expect.objectContaining({ id: 'plant-safety', label: 'Plant safety', inherited: false, fromPack: true })]);
    expect(safety.job!.escalations[0]!.packWords).toEqual(safety.job!.escalations[0]!.words);
    expect(desk.job!.escalations.every((e) => e.packWords.length > 0 && e.packWords.every((w) => e.words.includes(w)))).toBe(true);
    expect(await agentsService().get(org.tenantId, safety.id)).toMatchObject({ job: safety.job, jobs: [] });

    const { jobId } = await installJobFixture(h, org, manualJob('spec-card-jobs'));
    const tester = await agentOf(org, JOB_TESTER);
    expect(tester.jobs).toEqual([expect.objectContaining({ id: jobId, agentRole: JOB_TESTER, trigger: 'manual', enabled: true, lastRun: null })]);
    expect((await agentOf(org, 'consumer-desk')).jobs).toEqual([]);
  });

  it('refuses to remove a word from emergency, to drop a pack set, or to empty an agent pack set, and saves nothing', async () => {
    const org = await newOrg(h, 'power-plant');
    const desk = await agentOf(org, 'consumer-desk');
    const before = await storedCard(desk.id);
    const sets = editable(desk);

    const shortened = sets.map((s) => (s.id === 'emergency' ? { ...s, words: s.words.filter((w) => w !== 'gas leak') } : s));
    await expect(agentsService().update(org.session, desk.id, { job: { escalate: shortened } })).rejects.toThrow(PACK_SET_KEPT);
    await expect(agentsService().update(org.session, desk.id, { job: { escalate: shortened } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(agentsService().update(org.session, desk.id, { job: { escalate: sets.filter((s) => s.id !== 'distress') } })).rejects.toThrow(PACK_SET_KEPT);

    const safety = await agentOf(org, 'safety-desk');
    await expect(agentsService().update(org.session, safety.id, { job: { escalate: [] } })).rejects.toThrow(PACK_SET_KEPT);

    expect(await storedCard(desk.id)).toEqual(before);
    expect(await cardAudits(desk.id)).toEqual([]);
  });

  it('adds a word to an inherited set: kept as the owner set with the shared label, alert and reply, and audited', async () => {
    const org = await newOrg(h, 'power-plant');
    // The shared set alerts a role, so a merge that fell back to the default would show.
    await h.owner.query(
      `update workspaces set pack = jsonb_set(pack, '{escalations}', (select jsonb_agg(case when e->>'id' = 'emergency' then e || '{"alert": "safety-officer"}'::jsonb else e end) from jsonb_array_elements(pack->'escalations') e)) where id = $1`,
      [org.workspaceId],
    );
    const desk = await agentOf(org, 'consumer-desk');
    const emergency = desk.job!.escalations.find((e) => e.id === 'emergency')!;
    expect(emergency.alert).toBe('safety-officer');

    // The page may leave the alert and reply out: they keep what the set had.
    const sets = editable(desk).map((s) => (s.id === 'emergency' ? { id: s.id, label: s.label, words: [...s.words, 'sparking'] } : s));
    const after = await agentsService().update(org.session, desk.id, { job: { escalate: sets } });

    expect(after.job!.escalations.find((e) => e.id === 'emergency')).toEqual({ ...emergency, words: [...emergency.words, 'sparking'] });
    // The page can tell the owner's word from the pack's: only the pack's stay locked.
    expect(after.job!.escalations.find((e) => e.id === 'emergency')!.packWords).toEqual(emergency.packWords);
    expect(emergency.packWords).not.toContain('sparking');
    expect(after.job!.escalations.map((e) => e.id)).toEqual(['emergency', 'distress', 'anger', 'legal-threat', 'secrets']);
    const stored = await storedCard(desk.id);
    expect(stored?.escalate).toEqual([
      { id: 'emergency', label: 'Emergencies', words: [...emergency.words, 'sparking'], alert: 'safety-officer', reply: emergency.reply },
    ]);
    expect(await cardAudits(desk.id)).toEqual([expect.objectContaining({ name: 'Consumer service desk', changed: ['escalate'] })]);
    expect((await agentOf(org, 'consumer-desk')).job).toEqual(after.job);
  });

  it('adds an owner set, renames it and deletes it again', async () => {
    const org = await newOrg(h, 'power-plant');
    const desk = await agentOf(org, 'consumer-desk');
    const sets = editable(desk);

    const added = await agentsService().update(org.session, desk.id, {
      job: { escalate: [...sets, { id: 'meter-tamper', label: 'Meter tampering', words: ['tampered', 'meter seal', 'मीटर से छेड़छाड़'] }] },
    });
    expect(added.job!.escalations.at(-1)).toEqual({
      id: 'meter-tamper',
      label: 'Meter tampering',
      words: ['tampered', 'meter seal', 'मीटर से छेड़छाड़'],
      reply: null,
      alert: 'owner',
      inherited: false,
      fromPack: false,
      packWords: [],
    });

    const renamed = await agentsService().update(org.session, desk.id, { job: { escalate: editable(added).map((s) => (s.id === 'meter-tamper' ? { ...s, label: 'Meter tampering or theft' } : s)) } });
    expect(renamed.job!.escalations.at(-1)).toMatchObject({ id: 'meter-tamper', label: 'Meter tampering or theft' });

    const removed = await agentsService().update(org.session, desk.id, { job: { escalate: editable(renamed).filter((s) => s.id !== 'meter-tamper') } });
    expect(removed.job!.escalations).toEqual(desk.job!.escalations);
    expect((await storedCard(desk.id))?.escalate).toEqual([]);
    expect((await cardAudits(desk.id)).map((p) => p.changed)).toEqual([['escalate'], ['escalate'], ['escalate']]);
  });

  it('changes the mission and the never list, audited once, and an unchanged save changes nothing', async () => {
    const org = await newOrg(h, 'power-plant');
    const coordinator = await agentOf(org, 'case-coordinator');
    const after = await agentsService().update(org.session, coordinator.id, {
      job: { mission: 'Move every request through its stages, and ask a person whenever the rules say so.', never: [...coordinator.job!.never, 'Promising dates to customers'] },
    });
    expect(after.job).toMatchObject({
      mission: 'Move every request through its stages, and ask a person whenever the rules say so.',
      never: [...coordinator.job!.never, 'Promising dates to customers'],
      escalations: coordinator.job!.escalations,
    });
    expect((await storedCard(coordinator.id))?.mission).toBe('Move every request through its stages, and ask a person whenever the rules say so.');

    await agentsService().update(org.session, coordinator.id, { job: { mission: after.job!.mission, never: after.job!.never, escalate: editable(after) } });
    expect(await cardAudits(coordinator.id)).toEqual([expect.objectContaining({ name: 'Case coordinator', changed: ['mission', 'never'] })]);
  });

  it('a save that changes nothing writes and audits nothing, also on cards that hold sets of their own', async () => {
    const org = await newOrg(h, 'power-plant');
    const stamp = async (agentId: string) =>
      (await h.owner.query<{ t: Date }>(`select updated_at as t from agents where id = $1`, [agentId])).rows[0]!.t.toISOString();
    const resave = (view: AgentView, mission = view.job!.mission) =>
      agentsService().update(org.session, view.id, { job: { mission, never: view.job!.never, escalate: editable(view) } });

    // The safety desk's card holds its pack set from install, read back from jsonb.
    const safety = await agentOf(org, 'safety-desk');
    const safetyStamp = await stamp(safety.id);
    expect(await resave(safety)).toMatchObject({ job: safety.job });
    expect(await stamp(safety.id)).toBe(safetyStamp);
    expect(await cardAudits(safety.id)).toEqual([]);

    // The consumer desk once the owner has added a word to an inherited set.
    const desk = await agentOf(org, 'consumer-desk');
    const added = await agentsService().update(org.session, desk.id, {
      job: { escalate: editable(desk).map((s) => (s.id === 'emergency' ? { ...s, words: [...s.words, 'sparking'] } : s)) },
    });
    const deskStamp = await stamp(desk.id);
    await resave(added);
    expect(await stamp(desk.id)).toBe(deskStamp);
    expect((await cardAudits(desk.id)).map((p) => p.changed)).toEqual([['escalate']]);

    await resave(added, 'Register supply complaints and keep consumers updated by SMS.');
    expect((await cardAudits(desk.id)).map((p) => p.changed)).toEqual([['escalate'], ['mission']]);
  });
});
