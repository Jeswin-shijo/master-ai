import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  isUntrusted,
  jobById,
  lifecycleOf,
  normalizeSnapshot,
  offlineReview,
  registersOf,
  requestJobsFor,
  resolveDueRule,
  startJobState,
  withPreset,
} from '@onehuman/agent-kit';
import type {
  CaseSource,
  JobDef,
  JobRunStart,
  JobRunView,
  JobSkipReason,
  JobSwitchInput,
  JobTriggerKind,
  JobView,
  PlannedTask,
  ResolvedPack,
  RunJobInput,
} from '@onehuman/schemas';
import { AuditService, SYSTEM, type Actor } from '../audit/audit.service';
import type { Session } from '../common/auth';
import { iso } from '../common/zod';
import { afterCommit, DbService, type Tx } from '../db/db.service';
import { agents, auditEvents, cases, goals, jobRuns, jobSettings, tasks, tenants, workspaces } from '../db/schema';
import { conditionSql, dayExpr, dueRuleSql } from '../lists/sql';
import { NotificationsService } from '../notifications/notifications.service';
import type { JobScheduleInput } from '../orchestration/shared';
import { goalWorkflowId, TemporalService } from '../orchestration/temporal.service';
import { RecordsService } from '../records/records.service';
import { istDate } from '../voice/time';
import { runText, triggerKind, triggerText } from './describe';

type SettingsRow = typeof jobSettings.$inferSelect;
type RunRow = typeof jobRuns.$inferSelect;
type CaseRow = typeof cases.$inferSelect;

/** At most this many runs start for one job in one sweep; the rest wait for the next sweep. */
const SWEEP_MAX = 50;
/** Changed records are read a page at a time. */
const SWEEP_PAGE = 100;

export interface StartRunInput {
  workspaceId: string;
  jobId: string;
  trigger: JobTriggerKind;
  /** One run per key and job: the schedule tick, the item and its due date, the record version, the case. */
  dedupeKey: string;
  /** What the job's `read from: trigger` step sees. */
  payload: Record<string, unknown>;
  caseId?: string;
  origin: 'owner' | 'inbound';
  createdBy?: string;
  /** Run inside this goal instead of a goal of its own (a case's stage 6 goal). */
  goalId?: string;
}

export type SkipReason = JobSkipReason;
export type StartRunResult = JobRunStart;

/** Raised inside the run's savepoint so the goal and task inserted for a duplicate trigger roll back. */
class DuplicateRun extends Error {}

/** Midnight in India today: the daily cap counts runs since then. */
const istDayStart = () => new Date(`${istDate()}T00:00:00+05:30`);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Words from outside the company (a customer, a form, a partner system) make the run's goal inbound. */
const originOf = (source: CaseSource): 'owner' | 'inbound' => (isUntrusted(source) ? 'inbound' : 'owner');

/** What a request job's `read from: trigger` step sees: the case number, its title, the request's own words and who sent it. */
function requestPayload(c: CaseRow, reworkNote?: string): Record<string, unknown> {
  return {
    code: c.code,
    title: c.title,
    text: c.file.request?.text ?? c.title,
    from: c.requester.name,
    ...(reworkNote && { note: reworkNote }),
  };
}

/** A switched-on list or record job, ready to sweep. */
interface Swept {
  settingsId: string;
  workspaceId: string;
  pack: ResolvedPack;
  job: JobDef;
}

/**
 * Jobs: the owner's switches (on or off, and the daily cap), the runs that
 * triggers start, and Run now. A run is an ordinary goal with one task planned
 * in advance (key `job-<jobId>`), so the task workflow, the policy engine,
 * approvals, pause, budgets and the audit trail are the same as for any goal.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly temporal: TemporalService,
    private readonly notifications: NotificationsService,
    private readonly records: RecordsService,
  ) {}

  // ---------- reads ----------

  /** The workspace's jobs, each with its switch, its cap, what starts it and its last run. */
  async list(tenantId: string, workspaceId?: string): Promise<JobView[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.records.activeWorkspace(tx, workspaceId);
      return this.views(tx, ws.id, ws.pack);
    });
  }

  /** One workspace's jobs as `list` shows them, inside the caller's transaction (the Agents page groups them by agent). */
  async views(tx: Tx, workspaceId: string, snapshot: ResolvedPack): Promise<JobView[]> {
    const pack = normalizeSnapshot(snapshot);
    if (pack.jobs.length === 0) return [];
    const settings = await tx.select().from(jobSettings).where(eq(jobSettings.workspaceId, workspaceId));
    const last = await tx
      .selectDistinctOn([jobRuns.jobId])
      .from(jobRuns)
      .where(eq(jobRuns.workspaceId, workspaceId))
      .orderBy(jobRuns.jobId, desc(jobRuns.createdAt));
    return pack.jobs.map((job) =>
      toJobView(
        pack,
        job,
        settings.find((s) => s.jobId === job.id),
        last.find((r) => r.jobId === job.id),
      ),
    );
  }

  /** A job's latest runs, newest first. */
  async runs(tenantId: string, jobId: string, limit = 20): Promise<JobRunView[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const ws = await this.records.activeWorkspace(tx);
      const rows = await tx
        .select()
        .from(jobRuns)
        .where(and(eq(jobRuns.workspaceId, ws.id), eq(jobRuns.jobId, jobId)))
        .orderBy(desc(jobRuns.createdAt))
        .limit(Math.min(Math.max(limit, 1), 100));
      return rows.map(toRunView);
    });
  }

  // ---------- switches ----------

  /**
   * Switch a job on or off, or change its daily cap. A job only goes on when its
   * agent has a job card. Its schedule follows the switch once it is saved.
   */
  async switch(session: Session, jobId: string, input: JobSwitchInput): Promise<JobView> {
    const saved = await this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.records.activeWorkspace(tx);
      const pack = normalizeSnapshot(ws.pack);
      const job = jobById(pack, jobId);
      if (!job) throw new NotFoundException('That job is not part of your setup');
      if (input.enabled === true && !(await this.hasCard(tx, ws.id, pack, job))) throw new BadRequestException('This agent has no job card');
      const [had] = await tx
        .select()
        .from(jobSettings)
        .where(and(eq(jobSettings.workspaceId, ws.id), eq(jobSettings.jobId, jobId)))
        .for('update');
      const enabled = input.enabled ?? had?.enabled ?? false;
      const dailyCap = input.dailyCap ?? had?.dailyCap ?? job.daily_cap;
      // Switched on (again): a record job looks at changes from now, not at what changed while it was off.
      const fromNow = enabled && !had?.enabled ? { sweptAt: sql`now()` } : {};
      const [row] = await tx
        .insert(jobSettings)
        .values({ tenantId: session.tenantId, workspaceId: ws.id, jobId, enabled, dailyCap, updatedBy: session.principalId, ...fromNow })
        .onConflictDoUpdate({
          target: [jobSettings.workspaceId, jobSettings.jobId],
          set: { enabled, dailyCap, updatedBy: session.principalId, updatedAt: new Date(), ...fromNow },
        })
        .returning();
      await this.audit.append(tx, session.tenantId, {
        type: 'job.switched',
        actor: { id: session.principalId, kind: 'human' },
        refId: row!.id,
        payload: { job: job.name, jobId, workspaceId: ws.id, enabled, dailyCap },
      });
      const [last] = await tx
        .select()
        .from(jobRuns)
        .where(and(eq(jobRuns.workspaceId, ws.id), eq(jobRuns.jobId, jobId)))
        .orderBy(desc(jobRuns.createdAt))
        .limit(1);
      return { view: toJobView(pack, job, row, last), job, workspaceId: ws.id, enabled };
    });
    if (input.enabled !== undefined) {
      await this.syncSchedule(session.tenantId, saved.workspaceId, saved.job, saved.enabled);
      if (sweeps(saved.job)) await this.syncSweep(session.tenantId);
    }
    return saved.view;
  }

  /**
   * A new install: every job of the pack is on (its agent starts on trial).
   * Its mark is clock_timestamp(), not now(): rows the same transaction seeds
   * afterwards carry now() and so lie before the mark.
   * Runs inside the install's transaction; the schedules follow the commit.
   */
  async enableAll(tx: Tx, tenantId: string, workspaceId: string, pack: ResolvedPack, actor: Actor): Promise<void> {
    let sweep = false;
    for (const job of pack.jobs ?? []) {
      const [row] = await tx
        .insert(jobSettings)
        .values({ tenantId, workspaceId, jobId: job.id, enabled: true, dailyCap: job.daily_cap, updatedBy: actor.id, sweptAt: sql`clock_timestamp()` })
        .onConflictDoNothing()
        .returning();
      if (!row) continue;
      await this.audit.append(tx, tenantId, {
        type: 'job.switched',
        actor,
        refId: row.id,
        payload: { job: job.name, jobId: job.id, workspaceId, enabled: true, dailyCap: job.daily_cap },
      });
      if (job.trigger.schedule) afterCommit(tx, () => void this.syncSchedule(tenantId, workspaceId, job, true));
      sweep ||= sweeps(job);
    }
    if (sweep) afterCommit(tx, () => void this.syncSweep(tenantId));
  }

  // ---------- runs ----------

  /** Run now: by hand, whether or not the job is switched on. */
  async runNow(session: Session, jobId: string, input: RunJobInput): Promise<StartRunResult> {
    const ws = await this.db.tenant(session.tenantId, (tx) => this.records.activeWorkspace(tx));
    if (!jobById(normalizeSnapshot(ws.pack), jobId)) throw new NotFoundException('That job is not part of your setup');
    return this.startRun(session.tenantId, {
      workspaceId: ws.id,
      jobId,
      trigger: 'manual',
      dedupeKey: `manual:${randomUUID()}`,
      payload: { text: input.input ?? null, by: session.principalId },
      origin: 'owner',
      createdBy: session.principalId,
    });
  }

  /** A scheduled job's time came round (the jobScheduleWorkflow activity). One run per day and time. */
  async startScheduled(i: JobScheduleInput): Promise<StartRunResult> {
    const time = await this.db.tenant(i.tenantId, async (tx) => {
      const [ws] = await tx.select({ pack: workspaces.pack }).from(workspaces).where(eq(workspaces.id, i.workspaceId));
      return ws ? (jobById(normalizeSnapshot(ws.pack), i.jobId)?.trigger.schedule?.time ?? null) : null;
    });
    if (!time) return { skipped: 'off' };
    const date = istDate();
    return this.startRun(i.tenantId, {
      workspaceId: i.workspaceId,
      jobId: i.jobId,
      trigger: 'schedule',
      dedupeKey: `schedule:${date}T${time}`,
      payload: { date },
      origin: 'owner',
    });
  }

  /**
   * Start one run of a job: a goal (or the given one), its one task and the run.
   * Nothing starts while the job is off (Run now aside), its agent, workspace or
   * company is paused, today's runs reached the cap, or this trigger already ran.
   * The goal's workflow starts once the run is saved.
   */
  async startRun(tenantId: string, input: StartRunInput): Promise<StartRunResult> {
    const started = await this.db.tenant(tenantId, (tx) => this.begin(tx, tenantId, input));
    if ('skipped' in started) return started;
    if (!input.goalId) {
      try {
        await this.temporal.startGoal({ tenantId, goalId: started.goalId, autoStart: true });
      } catch (err) {
        await this.couldNotStart(tenantId, started);
        throw err;
      }
    }
    return { runId: started.runId, goalId: started.goalId };
  }

  private async begin(tx: Tx, tenantId: string, input: StartRunInput): Promise<{ skipped: SkipReason } | Begun> {
    const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, input.workspaceId));
    if (!ws) return { skipped: 'off' };
    const pack = normalizeSnapshot(ws.pack);
    const job = jobById(pack, input.jobId);
    if (!job) return { skipped: 'off' };
    // Locked: starts of one job queue here, so the cap and the once-a-day alert count right.
    const [settings] = await tx
      .select()
      .from(jobSettings)
      .where(and(eq(jobSettings.workspaceId, ws.id), eq(jobSettings.jobId, job.id)))
      .for('update');
    if (input.trigger !== 'manual' && !settings?.enabled) return { skipped: 'off' };
    const [agent] = await tx.select().from(agents).where(and(eq(agents.workspaceId, ws.id), eq(agents.role, job.agent)));
    if (!agent) return { skipped: 'off' };
    const [tenant] = await tx.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
    if (tenant?.status === 'paused' || ws.status === 'paused' || agent.status !== 'active') return { skipped: 'paused' };

    const sameJob = and(eq(jobRuns.workspaceId, ws.id), eq(jobRuns.jobId, job.id));
    const [seen] = await tx.select({ id: jobRuns.id }).from(jobRuns).where(and(sameJob, eq(jobRuns.dedupeKey, input.dedupeKey))).limit(1);
    if (seen) return { skipped: 'duplicate' };
    const cap = settings?.dailyCap ?? job.daily_cap;
    const [today] = await tx.select({ n: count() }).from(jobRuns).where(and(sameJob, gte(jobRuns.createdAt, istDayStart())));
    if ((today?.n ?? 0) >= cap) {
      await this.capReached(tx, tenantId, ws.id, job, cap, settings);
      return { skipped: 'cap' };
    }

    const words = runText(pack, job, input.trigger, input.payload);
    const planned: PlannedTask = { key: `job-${job.id}`, title: job.name, description: words.full, agentRole: job.agent, dependsOn: [] };
    const plan = { tasks: [planned], rationale: `${job.name} follows its own steps.` };
    const goalId = input.goalId ?? randomUUID();
    const ids = await tx
      .transaction(async (sp) => {
        if (input.goalId) {
          await sp.update(goals).set({ plan, status: 'running', updatedAt: new Date() }).where(eq(goals.id, goalId));
        } else {
          await sp.insert(goals).values({
            id: goalId,
            tenantId,
            workspaceId: ws.id,
            createdBy: input.createdBy ?? null,
            text: `${job.name}: ${words.short}`,
            origin: input.origin,
            status: 'running',
            plan,
            workflowId: goalWorkflowId(goalId),
          });
        }
        const [task] = await sp
          .insert(tasks)
          .values({ tenantId, goalId, key: planned.key, title: planned.title, description: planned.description, agentId: agent.id })
          .returning({ id: tasks.id });
        const [run] = await sp
          .insert(jobRuns)
          .values({
            tenantId,
            workspaceId: ws.id,
            jobId: job.id,
            agentId: agent.id,
            goalId,
            taskId: task!.id,
            caseId: input.caseId ?? null,
            trigger: input.trigger,
            dedupeKey: input.dedupeKey,
            input: input.payload,
            state: startJobState(),
          })
          .onConflictDoNothing({ target: [jobRuns.workspaceId, jobRuns.jobId, jobRuns.dedupeKey] })
          .returning({ id: jobRuns.id });
        // Another start took this key since the check above: undo this goal and task.
        if (!run) throw new DuplicateRun();
        return { taskId: task!.id, runId: run.id };
      })
      .catch((err: unknown) => {
        if (err instanceof DuplicateRun) return null;
        throw err;
      });
    if (!ids) return { skipped: 'duplicate' };

    await this.audit.append(tx, tenantId, {
      type: 'job.run_started',
      actor: input.createdBy ? { id: input.createdBy, kind: 'human' } : SYSTEM,
      goalId,
      taskId: ids.taskId,
      refId: ids.runId,
      payload: { job: job.name, jobId: job.id, trigger: input.trigger, ...(input.caseId && { caseId: input.caseId }) },
    });
    return { ...ids, goalId, jobName: job.name };
  }

  /** Today's runs reached the cap: tell the owner, once a day per job (the audit trail remembers). */
  private async capReached(tx: Tx, tenantId: string, workspaceId: string, job: JobDef, cap: number, settings: SettingsRow | undefined) {
    const [told] = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.type, 'job.switched'),
          gte(auditEvents.createdAt, istDayStart()),
          sql`${auditEvents.payload}->>'cap' = 'true'`,
          sql`${auditEvents.payload}->>'jobId' = ${job.id}`,
          sql`${auditEvents.payload}->>'workspaceId' = ${workspaceId}`,
        ),
      )
      .limit(1);
    if (told) return;
    const message = `${job.name} reached its daily limit of ${plural(cap, 'run')}`;
    await this.audit.append(tx, tenantId, {
      type: 'job.switched',
      actor: SYSTEM,
      refId: settings?.id ?? null,
      payload: { job: job.name, jobId: job.id, workspaceId, enabled: settings?.enabled ?? false, dailyCap: cap, cap: true, message },
    });
    afterCommit(tx, () => void this.notifications.pushToManagers(tenantId, { title: 'Daily limit reached', body: message, data: { jobId: job.id } }));
  }

  /** The goal's workflow could not be started: end the run plainly instead of leaving it running for ever. */
  private async couldNotStart(tenantId: string, run: Begun) {
    const summary = 'The run could not start. Try again in a minute.';
    try {
      await this.db.tenant(tenantId, async (tx) => {
        const [row] = await tx
          .update(jobRuns)
          .set({ status: 'failed', summary, finishedAt: new Date() })
          .where(and(eq(jobRuns.id, run.runId), eq(jobRuns.status, 'running')))
          .returning();
        if (!row) return;
        await tx.update(tasks).set({ status: 'failed', completedAt: new Date() }).where(eq(tasks.id, run.taskId));
        await tx.update(goals).set({ status: 'failed', summary, completedAt: new Date(), updatedAt: new Date() }).where(eq(goals.id, run.goalId));
        await this.audit.append(tx, tenantId, {
          type: 'job.run_finished',
          actor: SYSTEM,
          goalId: run.goalId,
          taskId: run.taskId,
          refId: run.runId,
          payload: { job: run.jobName, jobId: row.jobId, status: 'failed', summary },
        });
      });
    } catch (err) {
      this.logger.error(`Job run ${run.runId} could not start and could not be marked failed: ${(err as Error).message}`);
    }
  }

  // ---------- request triggers ----------

  /**
   * A request just arrived: each switched-on request job with `at: arrival`
   * that covers its provisional category (the rules' first reading of it, as
   * review would make it offline), or that lists `any`, starts one run in a
   * goal of its own, so a first reply doesn't wait for stages 2 to 5. Once per
   * case and job: calling it again starts nothing.
   */
  async startArrivalRuns(tenantId: string, c: CaseRow): Promise<{ jobId: string; result: StartRunResult }[]> {
    const found = await this.db.tenant(tenantId, async (tx) => {
      // Most packs have no arrival job: look at the jobs alone before reading the whole pack.
      const [has] = await tx
        .select({ jobs: sql<Partial<JobDef>[] | null>`${workspaces.pack}->'jobs'` })
        .from(workspaces)
        .where(eq(workspaces.id, c.workspaceId));
      if (!has?.jobs?.some((j) => j.trigger?.request?.at === 'arrival')) return [];
      const [ws] = await tx.select({ pack: workspaces.pack }).from(workspaces).where(eq(workspaces.id, c.workspaceId));
      if (!ws) return [];
      const pack = normalizeSnapshot(ws.pack);
      const request = c.file.request;
      const category = request ? offlineReview(withPreset(lifecycleOf(pack), request), request, request.amountInr).provisionalCategory : null;
      const matching = requestJobsFor(pack, category, 'arrival');
      if (!matching.length) return [];
      const on = new Set(
        (
          await tx
            .select({ jobId: jobSettings.jobId })
            .from(jobSettings)
            .where(and(eq(jobSettings.workspaceId, c.workspaceId), eq(jobSettings.enabled, true), inArray(jobSettings.jobId, matching.map((j) => j.id))))
        ).map((r) => r.jobId),
      );
      return matching.filter((j) => on.has(j.id));
    });
    const out: { jobId: string; result: StartRunResult }[] = [];
    for (const job of found) {
      try {
        const result = await this.startRun(tenantId, {
          workspaceId: c.workspaceId,
          jobId: job.id,
          trigger: 'request',
          dedupeKey: `arrival:${c.id}`,
          caseId: c.id,
          origin: originOf(c.source),
          payload: requestPayload(c),
        });
        out.push({ jobId: job.id, result });
      } catch (err) {
        // The run is already marked failed; the other jobs still start.
        this.logger.error(`Job ${job.id} could not start for case ${c.code}: ${(err as Error).message}`);
      }
    }
    return out;
  }

  /**
   * Stage 6 of a case, step 1: the first switched-on request job with `at:
   * execute` (pack order) that covers the case's category, or null. Called in
   * startExecution's transaction before its first audit: the job's switch row
   * is locked here, so that transaction takes its locks in the order switches
   * and run starts do (the switch row, then the audit chain).
   */
  async executeJobFor(tx: Tx, workspaceId: string, pack: ResolvedPack, category: string | null): Promise<JobDef | null> {
    for (const job of requestJobsFor(pack, category, 'execute')) {
      const [on] = await tx
        .select({ id: jobSettings.id })
        .from(jobSettings)
        .where(and(eq(jobSettings.workspaceId, workspaceId), eq(jobSettings.jobId, job.id), eq(jobSettings.enabled, true)))
        .for('update');
      if (on) return job;
    }
    return null;
  }

  /**
   * Stage 6, step 2, in the same transaction once the case's goal is saved: the
   * job's task and run go into that goal (key `case:<caseId>:<attempt>`), so
   * planning finds the task instead of planning. The case workflow starts the
   * goal; nothing is started here, and a refusal (paused, cap, duplicate) leaves
   * the goal to be planned as before.
   */
  async startInCaseGoal(tx: Tx, tenantId: string, i: { job: JobDef; caseRow: CaseRow; goalId: string; attempt: number; reworkNote?: string }): Promise<StartRunResult> {
    const c = i.caseRow;
    const started = await this.begin(tx, tenantId, {
      workspaceId: c.workspaceId,
      jobId: i.job.id,
      trigger: 'request',
      dedupeKey: `case:${c.id}:${i.attempt}`,
      caseId: c.id,
      goalId: i.goalId,
      origin: originOf(c.source),
      payload: requestPayload(c, i.reworkNote),
    });
    return 'skipped' in started ? started : { runId: started.runId, goalId: started.goalId };
  }

  // ---------- the list and record sweep ----------

  /**
   * The 10-minute sweep. Each switched-on list job starts a run for each due
   * item of its list (once per item and due date); each record job one per
   * change to a record of its type since it last looked (once per record
   * version). At most 50 runs start per job and sweep, and the daily cap still
   * applies: what is left waits for a later sweep. Nothing starts while the
   * company is paused, and nothing is marked seen either.
   */
  async sweep(tenantId: string): Promise<{ started: number }> {
    const due = await this.db.tenant(tenantId, async (tx) => {
      const [tenant] = await tx.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
      return !tenant || tenant.status === 'paused' ? [] : this.sweptJobs(tx);
    });
    let started = 0;
    for (const s of due) {
      try {
        started += s.job.trigger.list ? await this.sweepList(tenantId, s) : await this.sweepRecords(tenantId, s);
      } catch (err) {
        this.logger.error(`The sweep of job ${s.job.id} stopped: ${(err as Error).message}`);
      }
    }
    return { started };
  }

  /** Due items with no run for their due date yet, earliest first. */
  private async sweepList(tenantId: string, s: Swept): Promise<number> {
    const t = s.job.trigger.list!;
    const reg = registersOf(s.pack).find((r) => r.id === t.list);
    const due = reg ? resolveDueRule(t.due, reg.entity, `job:${s.job.id}`) : null;
    if (!reg || !due) return 0;
    const field = due.field.name;
    const now = new Date();
    const items = await this.db.tenant(tenantId, async (tx) =>
      (
        await tx.execute<{ id: string; data: Record<string, unknown> }>(sql`
          select r.id, r.data from records r
          where r.workspace_id = ${s.workspaceId} and r.entity = ${reg.entity.name} and r.source <> 'sample'
            and ${dueRuleSql({ due, ...(t.when && { when: t.when }) }, reg.entity, { now, today: istDate(now) })}
            and not exists (
              select 1 from job_runs j where j.workspace_id = r.workspace_id and j.job_id = ${s.job.id}
                and j.dedupe_key = 'item:' || r.id::text || ':' || coalesce(r.data->>${field}, ''))
          order by ${dayExpr(due.field)} asc nulls last, r.id
          limit ${SWEEP_MAX}`)
      ).rows,
    );
    let started = 0;
    for (const item of items) {
      const result = await this.startRun(tenantId, {
        workspaceId: s.workspaceId,
        jobId: s.job.id,
        trigger: 'list',
        dedupeKey: `item:${item.id}:${String(item.data[field] ?? '')}`,
        payload: { item: { id: item.id, ...item.data } },
        origin: 'owner',
      });
      if ('runId' in result) started++;
      else if (result.skipped !== 'duplicate') break; // paused, switched off or the cap: the items stay due
    }
    await this.db.tenant(tenantId, (tx) => tx.update(jobSettings).set({ sweptAt: sql`now()` }).where(eq(jobSettings.id, s.settingsId)));
    return started;
  }

  /**
   * Records changed (or added, for `on: created`) since the job last looked,
   * oldest change first. The mark then moves past what was looked at, to a
   * minute before this sweep began: a change saved by a transaction still open
   * while the sweep read is seen next time, and its run key makes a second look
   * start nothing. Stopped early (paused, the cap, 50 runs), the mark moves only
   * to the last change handled, so the rest wait instead of being lost.
   */
  private async sweepRecords(tenantId: string, s: Swept): Promise<number> {
    const t = s.job.trigger.record!;
    const entity = s.pack.entities.find((e) => e.name === t.entity);
    if (!entity) return 0;
    const version = sql.raw(t.on === 'created' ? 'r.created_at' : 'r.updated_at');
    const changed = t.on === 'updated' ? sql`and r.updated_at > r.created_at` : sql``;
    const mark = sql`(select coalesce(js.swept_at, js.updated_at) from job_settings js where js.id = ${s.settingsId})`;
    type Row = { id: string; data: Record<string, unknown>; v: string; at: Date };

    let started = 0;
    let stopped = false;
    let last: string | null = null;
    let looked: string | null = null;
    for (let after: Row | null = null; ; ) {
      const page: { rows: Row[]; now: string } = await this.db.tenant(tenantId, async (tx) => {
        const [clock] = (await tx.execute<{ now: string }>(sql`select now()::text as now`)).rows;
        const rows = (
          await tx.execute<Row>(sql`
            select r.id, r.data, ${version}::text as v, ${version} as at from records r
            where r.workspace_id = ${s.workspaceId} and r.entity = ${entity.name} and r.source <> 'sample'
              and ${version} >= ${mark} ${changed}
              and (${conditionSql(entity, t.when)})
              ${after ? sql`and (${version}, r.id) > (${after.v}::timestamptz, ${after.id}::uuid)` : sql``}
            order by ${version}, r.id
            limit ${SWEEP_PAGE}`)
        ).rows;
        return { rows, now: clock!.now };
      });
      looked ??= page.now;
      for (const row of page.rows) {
        const result = await this.startRun(tenantId, {
          workspaceId: s.workspaceId,
          jobId: s.job.id,
          trigger: 'record',
          dedupeKey: `record:${row.id}:${new Date(row.at).toISOString()}`,
          payload: { record: { id: row.id, ...row.data } },
          origin: 'owner',
        });
        if ('skipped' in result && result.skipped !== 'duplicate') {
          stopped = true;
          break;
        }
        last = row.v;
        if ('runId' in result && ++started >= SWEEP_MAX) {
          stopped = true;
          break;
        }
      }
      if (stopped || page.rows.length < SWEEP_PAGE) break;
      after = page.rows.at(-1)!;
    }
    const to = stopped ? (last ? sql`${last}::timestamptz` : null) : sql`${looked}::timestamptz - interval '1 minute'`;
    if (to) {
      // greatest(): never back, and never behind a switch-on that happened while this sweep ran.
      await this.db.tenant(tenantId, (tx) =>
        tx
          .update(jobSettings)
          .set({ sweptAt: sql`greatest(coalesce(${jobSettings.sweptAt}, ${jobSettings.updatedAt}), ${to})` })
          .where(eq(jobSettings.id, s.settingsId)),
      );
    }
    return started;
  }

  /** The company's switched-on list and record jobs. */
  private async sweptJobs(tx: Tx): Promise<Swept[]> {
    const on = await tx
      .select({ id: jobSettings.id, workspaceId: jobSettings.workspaceId, jobId: jobSettings.jobId })
      .from(jobSettings)
      .where(eq(jobSettings.enabled, true));
    if (!on.length) return [];
    const rows = await tx
      .select({ id: workspaces.id, pack: workspaces.pack })
      .from(workspaces)
      .where(inArray(workspaces.id, [...new Set(on.map((s) => s.workspaceId))]));
    const packs = new Map(rows.map((w) => [w.id, normalizeSnapshot(w.pack)]));
    return on.flatMap((s) => {
      const pack = packs.get(s.workspaceId);
      const job = pack && jobById(pack, s.jobId);
      return pack && job && sweeps(job) ? [{ settingsId: s.id, workspaceId: s.workspaceId, pack, job }] : [];
    });
  }

  // ---------- helpers ----------

  /** The card the runner uses: the agent's own (edited) card, else the pack's. */
  private async hasCard(tx: Tx, workspaceId: string, pack: ResolvedPack, job: JobDef): Promise<boolean> {
    const [agent] = await tx.select({ spec: agents.spec }).from(agents).where(and(eq(agents.workspaceId, workspaceId), eq(agents.role, job.agent)));
    return !!(agent?.spec.job ?? pack.agents.find((a) => a.role === job.agent)?.job);
  }

  /** A scheduled job's own Temporal schedule follows its switch. */
  private async syncSchedule(tenantId: string, workspaceId: string, job: JobDef, enabled: boolean) {
    const schedule = job.trigger.schedule;
    if (!schedule) return;
    try {
      await this.temporal.syncJobSchedule({ tenantId, workspaceId, jobId: job.id, days: schedule.days, time: schedule.time, active: enabled });
    } catch (err) {
      this.logger.error(`Could not schedule job ${job.id}: ${(err as Error).message}`);
    }
  }

  /** The company's 10-minute sweep runs while any list or record job is on. */
  private async syncSweep(tenantId: string) {
    try {
      const active = await this.db.tenant(tenantId, async (tx) => (await this.sweptJobs(tx)).length > 0);
      await this.temporal.syncJobSweep({ tenantId, active });
    } catch (err) {
      this.logger.error(`Could not schedule the job sweep for ${tenantId}: ${(err as Error).message}`);
    }
  }
}

/** List and record jobs are started by the sweep. */
const sweeps = (job: JobDef) => !!(job.trigger.list || job.trigger.record);

interface Begun {
  runId: string;
  goalId: string;
  taskId: string;
  jobName: string;
}

function toRunView(r: RunRow): JobRunView {
  return {
    id: r.id,
    jobId: r.jobId,
    trigger: r.trigger,
    status: r.status,
    summary: r.summary,
    flags: r.state.flags ?? [],
    createdAt: r.createdAt.toISOString(),
    finishedAt: iso(r.finishedAt),
    goalId: r.goalId,
    caseId: r.caseId,
  };
}

function toJobView(pack: ResolvedPack, job: JobDef, settings: SettingsRow | undefined, last: RunRow | undefined): JobView {
  return {
    id: job.id,
    name: job.name,
    description: job.description,
    agentRole: job.agent,
    trigger: triggerKind(job),
    triggerText: triggerText(pack, job),
    enabled: settings?.enabled ?? false,
    dailyCap: settings?.dailyCap ?? job.daily_cap,
    lastRun: last ? toRunView(last) : null,
  };
}
