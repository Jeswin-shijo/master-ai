import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { jobById, normalizeSnapshot, startJobState } from '@onehuman/agent-kit';
import type { JobDef, JobRunView, JobSwitchInput, JobTriggerKind, JobView, PlannedTask, ResolvedPack, RunJobInput } from '@onehuman/schemas';
import { AuditService, SYSTEM, type Actor } from '../audit/audit.service';
import type { Session } from '../common/auth';
import { iso } from '../common/zod';
import { afterCommit, DbService, type Tx } from '../db/db.service';
import { agents, auditEvents, goals, jobRuns, jobSettings, tasks, tenants, workspaces } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import type { JobScheduleInput } from '../orchestration/shared';
import { goalWorkflowId, TemporalService } from '../orchestration/temporal.service';
import { RecordsService } from '../records/records.service';
import { istDate } from '../voice/time';
import { runText, triggerKind, triggerText } from './describe';

type SettingsRow = typeof jobSettings.$inferSelect;
type RunRow = typeof jobRuns.$inferSelect;

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

export type SkipReason = 'off' | 'paused' | 'cap' | 'duplicate';
export type StartRunResult = { runId: string; goalId: string } | { skipped: SkipReason };

/** Raised inside the run's savepoint so the goal and task inserted for a duplicate trigger roll back. */
class DuplicateRun extends Error {}

/** Midnight in India today: the daily cap counts runs since then. */
const istDayStart = () => new Date(`${istDate()}T00:00:00+05:30`);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
      const pack = normalizeSnapshot(ws.pack);
      if (pack.jobs.length === 0) return [];
      const settings = await tx.select().from(jobSettings).where(eq(jobSettings.workspaceId, ws.id));
      const last = await tx
        .selectDistinctOn([jobRuns.jobId])
        .from(jobRuns)
        .where(eq(jobRuns.workspaceId, ws.id))
        .orderBy(jobRuns.jobId, desc(jobRuns.createdAt));
      return pack.jobs.map((job) =>
        toJobView(
          pack,
          job,
          settings.find((s) => s.jobId === job.id),
          last.find((r) => r.jobId === job.id),
        ),
      );
    });
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
      const [row] = await tx
        .insert(jobSettings)
        .values({ tenantId: session.tenantId, workspaceId: ws.id, jobId, enabled, dailyCap, updatedBy: session.principalId })
        .onConflictDoUpdate({
          target: [jobSettings.workspaceId, jobSettings.jobId],
          set: { enabled, dailyCap, updatedBy: session.principalId, updatedAt: new Date() },
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
    if (input.enabled !== undefined) await this.syncTriggers(session.tenantId, saved.workspaceId, saved.job, saved.enabled);
    return saved.view;
  }

  /**
   * A new install: every job of the pack is on (its agent starts on trial).
   * Runs inside the install's transaction; the schedules follow the commit.
   */
  async enableAll(tx: Tx, tenantId: string, workspaceId: string, pack: ResolvedPack, actor: Actor): Promise<void> {
    for (const job of pack.jobs ?? []) {
      const [row] = await tx
        .insert(jobSettings)
        .values({ tenantId, workspaceId, jobId: job.id, enabled: true, dailyCap: job.daily_cap, updatedBy: actor.id })
        .onConflictDoNothing()
        .returning();
      if (!row) continue;
      await this.audit.append(tx, tenantId, {
        type: 'job.switched',
        actor,
        refId: row.id,
        payload: { job: job.name, jobId: job.id, workspaceId, enabled: true, dailyCap: job.daily_cap },
      });
      afterCommit(tx, () => void this.syncTriggers(tenantId, workspaceId, job, true));
    }
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

  // ---------- helpers ----------

  /** The card the runner uses: the agent's own (edited) card, else the pack's. */
  private async hasCard(tx: Tx, workspaceId: string, pack: ResolvedPack, job: JobDef): Promise<boolean> {
    const [agent] = await tx.select({ spec: agents.spec }).from(agents).where(and(eq(agents.workspaceId, workspaceId), eq(agents.role, job.agent)));
    return !!(agent?.spec.job ?? pack.agents.find((a) => a.role === job.agent)?.job);
  }

  /** Keep what starts a job in step with its switch. Only scheduled jobs have a Temporal schedule of their own. */
  private async syncTriggers(tenantId: string, workspaceId: string, job: JobDef, enabled: boolean) {
    const schedule = job.trigger.schedule;
    if (!schedule) return;
    try {
      await this.temporal.syncJobSchedule({ tenantId, workspaceId, jobId: job.id, days: schedule.days, time: schedule.time, active: enabled });
    } catch (err) {
      this.logger.error(`Could not schedule job ${job.id}: ${(err as Error).message}`);
    }
  }
}

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
