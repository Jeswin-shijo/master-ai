import { HttpException, Injectable, Logger } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { JobDef, JobRunState, JobRunStatus, ReadStepDef, Requester, ResolvedPack } from '@onehuman/schemas';
import {
  advanceJob,
  escalationsFor,
  fillTemplate,
  forPeople,
  jobById,
  narrateStep,
  normalizeSnapshot,
  prepareArgs,
  recordActResult,
  resolveTool,
  type EffectiveEscalation,
  type JobAdvance,
  type JobContext,
  type JobEffects,
  type JobScope,
} from '@onehuman/agent-kit';
import { AuditService, type Actor } from '../audit/audit.service';
import { DbService, type Tx } from '../db/db.service';
import { cases, jobRuns, outbox, tasks, toolCalls } from '../db/schema';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { ListsService } from '../lists/lists.service';
import { LlmService } from '../llm/llm.service';
import { NotificationsService } from '../notifications/notifications.service';
import { addUsage, loadTaskContext, type TaskContext } from '../orchestration/context';
import type { AgentStepResult } from '../orchestration/shared';
import { RecordsService } from '../records/records.service';
import { istDate } from '../voice/time';
import { askJobAi } from './job-ai';

type RunRow = typeof jobRuns.$inferSelect;
type Act = Extract<JobAdvance, { kind: 'act' }>;
type Usage = { tokens: number; costInr: number };

/** Kept in the run's results beside the steps' own: the act whose tool call the run waits on, and the duplicate keys it checked. */
const WAITING = '__act';
const SEEN = '__seen';
interface Waiting {
  toolCallId: string;
  as: string;
  step: number;
}

interface Ending {
  status: Exclude<JobRunStatus, 'running'>;
  summary: string;
  flags?: string[];
  escalation?: { set: EffectiveEscalation; words: string[]; incoming: string };
}

/** A read step could not run (an unknown record type or list): the run stops instead of the workflow failing. */
class ReadFailed extends Error {}

/**
 * Runs job tasks. A job run is a goal with one task for the job's agent; the
 * task workflow asks this runner for each step instead of the model. The
 * script decides: reads, the AI's typed answer and checks happen here, and an
 * act becomes an ordinary proposed tool call that goes through the policy
 * engine, approvals, audit and narration like any agent action. The run waits
 * on that call and moves on once it ran, or stops when it did not.
 */
@Injectable()
export class JobRunnerService {
  private readonly logger = new Logger(JobRunnerService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly llm: LlmService,
    private readonly notifications: NotificationsService,
    private readonly records: RecordsService,
    private readonly lists: ListsService,
    private readonly knowledge: KnowledgeService,
  ) {}

  /** True when the task is a job run's. */
  async isJobTask(tenantId: string, taskId: string): Promise<boolean> {
    const rows = await this.db.tenant(tenantId, (tx) => tx.select({ id: jobRuns.id }).from(jobRuns).where(eq(jobRuns.taskId, taskId)).limit(1));
    return rows.length > 0;
  }

  /** The next step of the task's job run; null when the task has no run, so the model loop takes it. */
  async step(tenantId: string, taskId: string): Promise<AgentStepResult | null> {
    const loaded = await this.db.tenant(tenantId, async (tx) => {
      const [run] = await tx.select().from(jobRuns).where(eq(jobRuns.taskId, taskId));
      if (!run) return null;
      const ctx = await loadTaskContext(tx, taskId);
      const waiting = waitingOn(run.state);
      const [call] = waiting ? await tx.select().from(toolCalls).where(eq(toolCalls.id, waiting.toolCallId)) : [];
      return { run, ctx, waiting, call };
    });
    if (!loaded) return null;
    const { run, ctx, waiting, call } = loaded;
    if (run.status !== 'running') return ended(run.status, run.summary);

    const pack = normalizeSnapshot(ctx.workspace.pack);
    const job = jobById(pack, run.jobId);
    const name = job?.name ?? 'This job';
    const usage: Usage = { tokens: 0, costInr: 0 };
    let state = run.state;

    if (waiting) {
      const label = call ? narrateStep({ tool: call.tool, status: call.status, args: call.args, pack }).short : 'The last step';
      switch (call?.status ?? 'failed') {
        case 'executed':
          state = recordActResult(withoutWaiting(state), waiting.as, call!.result);
          break;
        case 'rejected':
          return this.end(tenantId, run, ctx, name, state, usage, { status: 'stopped', summary: `${label} was not approved` });
        case 'expired':
          return this.end(tenantId, run, ctx, name, state, usage, { status: 'stopped', summary: `${label} was not approved in time` });
        case 'blocked':
          return this.end(tenantId, run, ctx, name, state, usage, { status: 'stopped', summary: `${label} was blocked` });
        case 'failed':
          return this.end(tenantId, run, ctx, name, state, usage, { status: 'stopped', summary: `${label} failed` });
        default:
          // Still with the policy engine, a person or a delegation (or a retried step): the same proposal.
          return { kind: 'tool', toolCallId: call!.id };
      }
    }

    if (!job) return this.end(tenantId, run, ctx, name, state, usage, { status: 'stopped', summary: 'This job is no longer part of the workspace' });
    const card = ctx.agent.spec.job ?? pack.agents.find((a) => a.role === ctx.agent.role)?.job;
    if (!card) return this.end(tenantId, run, ctx, name, state, usage, { status: 'stopped', summary: `${ctx.agent.name} has no job card` });
    const budgets = ctx.agent.spec.budgets;
    if (ctx.task.steps >= budgets.max_steps) {
      return this.end(tenantId, run, ctx, name, state, usage, { status: 'stopped', summary: `Reached the step limit (${budgets.max_steps})` });
    }
    if (ctx.task.tokens >= budgets.tokens_per_task) {
      const used = `${ctx.task.tokens.toLocaleString('en-IN')} of ${budgets.tokens_per_task.toLocaleString('en-IN')}`;
      return this.end(tenantId, run, ctx, name, state, usage, { status: 'stopped', summary: `Token budget used up (${used})` });
    }

    const jobCtx: JobContext = {
      orgName: ctx.tenant.name,
      agent: { name: ctx.agent.name, job: card },
      escalations: escalationsFor({ agents: [{ ...ctx.agent.spec, role: ctx.agent.role, job: card }], escalations: pack.escalations ?? [] }, ctx.agent.role),
      trigger: run.input,
      today: istDate(),
    };
    const seen: string[] = [];
    let advanced: Awaited<ReturnType<typeof advanceJob>>;
    try {
      advanced = await advanceJob(job, jobCtx, state, this.effects(tenantId, run, ctx, pack, usage, seen));
    } catch (err) {
      if (!(err instanceof ReadFailed)) throw err;
      return this.end(tenantId, run, ctx, name, withSeen(state, seen), usage, { status: 'stopped', summary: err.message });
    }
    state = withSeen(advanced.state, seen);
    const next = advanced.next;

    if (next.kind === 'act') return this.act(tenantId, run, ctx, pack, job, state, next, usage);
    if (next.kind === 'done') return this.end(tenantId, run, ctx, name, state, usage, { status: 'done', summary: next.summary, flags: next.flags });
    return this.end(tenantId, run, ctx, name, state, usage, {
      status: next.outcome === 'person' ? 'needs_person' : 'stopped',
      summary: next.reason,
      ...(next.escalation && { escalation: { ...next.escalation, incoming: incomingWords(job, state, jobCtx) } }),
    });
  }

  /** An act becomes a proposed tool call for the workflow's policy check; the run waits on it. */
  private async act(tenantId: string, run: RunRow, ctx: TaskContext, pack: ResolvedPack, job: JobDef, state: JobRunState, act: Act, usage: Usage): Promise<AgentStepResult> {
    const agent = ctx.agent;
    const tool = resolveTool(pack, act.tool);
    if (!tool) return this.end(tenantId, run, ctx, job.name, state, usage, { status: 'stopped', summary: `${job.name} uses a step this workspace cannot do` });
    const label = narrateStep({ tool: act.tool, status: 'planned', args: act.args, pack }).short;
    const row = (status: string, extra: Partial<typeof toolCalls.$inferInsert> = {}) => ({
      tenantId,
      goalId: run.goalId,
      taskId: run.taskId,
      agentId: agent.id,
      tool: act.tool,
      args: act.args,
      rationale: rationale(job, pack, act),
      status,
      ...extra,
    });

    if (tool.primitive.control === 'handoff') {
      // As in the model loop: handing over is the step, and a person takes it from here.
      const reason = typeof act.args.reason === 'string' && act.args.reason ? act.args.reason : `${job.name} handed this to a person`;
      return this.end(tenantId, run, ctx, job.name, state, usage, { status: 'needs_person', summary: reason }, async (tx) => {
        await tx.insert(toolCalls).values(row('executed', { executedAt: new Date() }));
      });
    }

    const prepared = prepareArgs(tool, act.args);
    if (!prepared.ok) {
      return this.end(tenantId, run, ctx, job.name, state, usage, { status: 'needs_person', summary: `${label} could not be prepared from the data` }, async (tx) => {
        await tx.insert(toolCalls).values(row('failed', { error: prepared.issues.join('; ') }));
      });
    }

    return this.db.tenant(tenantId, async (tx) => {
      const [call] = await tx.insert(toolCalls).values(row('proposed', { args: prepared.args })).returning();
      const waiting: Waiting = { toolCallId: call!.id, as: act.as, step: act.stepIndex };
      await this.count(tx, run, usage);
      await tx
        .update(jobRuns)
        .set({ state: { ...state, results: { ...state.results, [WAITING]: waiting } } })
        .where(eq(jobRuns.id, run.id));
      await this.audit.append(tx, tenantId, {
        type: 'action.proposed',
        actor: actorOf(ctx),
        goalId: run.goalId,
        taskId: run.taskId,
        refId: call!.id,
        payload: { tool: act.tool, args: prepared.args, rationale: call!.rationale, job: job.id, step: act.stepIndex + 1 },
      });
      return { kind: 'tool', toolCallId: call!.id } as const;
    });
  }

  /** Ends the run: its status and summary, the audit, and for an escalation the reply draft and the alert after commit. */
  private async end(
    tenantId: string,
    run: RunRow,
    ctx: TaskContext,
    jobName: string,
    state: JobRunState,
    usage: Usage,
    ending: Ending,
    also?: (tx: Tx) => Promise<void>,
  ): Promise<AgentStepResult> {
    const escalation = ending.escalation;
    const finished = await this.db.tenant(tenantId, async (tx) => {
      const [updated] = await tx
        .update(jobRuns)
        .set({ status: ending.status, summary: ending.summary, state, finishedAt: new Date() })
        .where(and(eq(jobRuns.id, run.id), eq(jobRuns.status, 'running')))
        .returning();
      if (!updated) {
        // Another attempt ended it first: hand back that ending.
        const [now] = await tx.select().from(jobRuns).where(eq(jobRuns.id, run.id));
        return { status: now!.status, summary: now!.summary, fresh: false };
      }
      await this.count(tx, run, usage);
      await also?.(tx);
      const base = { actor: actorOf(ctx), goalId: run.goalId, taskId: run.taskId, refId: run.id };
      if (escalation) {
        const draftId = escalation.set.reply ? await this.replyDraft(tx, tenantId, run, jobName, escalation.set) : null;
        await this.audit.append(tx, tenantId, {
          type: 'job.escalated',
          ...base,
          payload: {
            job: jobName,
            jobId: run.jobId,
            set: escalation.set.id,
            label: escalation.set.label,
            words: escalation.words,
            alert: escalation.set.alert,
            status: ending.status,
            reason: ending.summary,
            replyDraftId: draftId,
          },
        });
      } else {
        await this.audit.append(tx, tenantId, {
          type: 'job.run_finished',
          ...base,
          payload: { job: jobName, jobId: run.jobId, status: ending.status, summary: ending.summary, flags: ending.flags ?? [] },
        });
      }
      return { status: ending.status, summary: ending.summary, fresh: true };
    });
    if (finished.fresh && escalation) {
      void this.notifications.pushToRole(tenantId, escalation.set.alert, {
        title: `${escalation.set.label}: ${jobName}`,
        body: escalation.incoming.slice(0, 100),
        data: { goalId: run.goalId },
      });
    }
    return ended(finished.status, finished.summary);
  }

  /** The set's reply to the person who wrote in, kept as a draft. Nothing is sent: delivery is decided later (plan 2). */
  private async replyDraft(tx: Tx, tenantId: string, run: RunRow, jobName: string, set: EffectiveEscalation): Promise<string> {
    const who = await requesterOf(tx, run);
    const [row] = await tx
      .insert(outbox)
      .values({
        tenantId,
        kind: 'message',
        status: 'draft',
        payload: {
          channel: who?.phone ? 'whatsapp' : who?.email ? 'email' : null,
          to: who?.phone ?? who?.email ?? who?.name ?? null,
          toName: who?.name ?? null,
          body: set.reply,
          job: jobName,
          jobRunId: run.id,
          escalation: set.label,
          note: 'Kept as a draft for a person; nothing was sent.',
        },
      })
      .returning();
    return row!.id;
  }

  /** One more step on the task, and what the AI calls cost. */
  private async count(tx: Tx, run: RunRow, usage: Usage) {
    await tx.update(tasks).set({ steps: sql`${tasks.steps} + 1` }).where(eq(tasks.id, run.taskId));
    if (usage.tokens || usage.costInr) await addUsage(tx, run.taskId, run.goalId, usage.tokens, usage.costInr);
  }

  /** What the engine cannot do itself. Each read is its own short transaction; the AI call holds none. */
  private effects(tenantId: string, run: RunRow, ctx: TaskContext, pack: ResolvedPack, usage: Usage, seen: string[]): JobEffects {
    const ws = { id: ctx.workspace.id, pack };
    return {
      read: async (step, scope) => {
        try {
          return await this.read(tenantId, run, ws, step, scope);
        } catch (err) {
          if (!(err instanceof HttpException)) throw err;
          this.logger.warn(`Job ${run.jobId} could not read ${step.as}: ${err.message}`);
          throw new ReadFailed(`Could not read the ${plain(step.as)}`);
        }
      },
      ai: async (step, prompt) => {
        const answer = await askJobAi(this.llm, {
          tenantId,
          goalId: run.goalId,
          taskId: run.taskId,
          agent: ctx.agent.spec,
          step,
          prompt,
          redactPii: ctx.tenant.settings.redactPii,
        });
        usage.tokens += answer.tokens;
        usage.costInr += answer.costInr;
        return answer.output;
      },
      seen: async (key) => {
        if (!seen.includes(key)) seen.push(key);
        const rows = await this.db.tenant(tenantId, (tx) =>
          tx
            .select({ id: jobRuns.id })
            .from(jobRuns)
            .where(
              and(
                eq(jobRuns.workspaceId, run.workspaceId),
                eq(jobRuns.jobId, run.jobId),
                ne(jobRuns.id, run.id),
                sql`${jobRuns.state}->'results'->${SEEN}::text @> ${JSON.stringify([key])}::jsonb`,
              ),
            )
            .limit(1),
        );
        return rows.length > 0;
      },
    };
  }

  private async read(tenantId: string, run: RunRow, ws: { id: string; pack: ResolvedPack }, step: ReadStepDef, scope: JobScope): Promise<unknown> {
    const query = step.query ? asText(fillTemplate(step.query, scope).value).trim() || undefined : undefined;
    switch (step.from) {
      case 'trigger':
        return run.input;
      case 'records':
        return this.db.tenant(tenantId, async (tx) => {
          const entity = this.records.entityOf(ws.pack, step.entity ?? '');
          const rows = await this.records.search(tx, ws.id, entity.name, {
            query,
            ...(step.when && { matching: { entity, when: step.when } }),
            limit: step.limit,
          });
          return rows.map((r) => ({ id: r.id, ...r.data }));
        });
      case 'list':
        // The items still to be dealt with (not yet checked by a person), each with the problems nobody has accepted.
        return this.db.tenant(tenantId, async (tx) => {
          const items = await this.lists.openItems(tx, ws, step.list ?? '', step.when, step.limit);
          return items.map((it) => ({
            id: it.id,
            title: it.title,
            ...it.data,
            problems: it.problems.filter((p) => !p.acknowledged).map((p) => p.message),
          }));
        });
      case 'knowledge':
        if (!query) return [];
        return this.db.tenant(tenantId, async (tx) =>
          (await this.knowledge.search(tx, query, step.limit)).map((p) => ({ id: p.id, title: p.title, text: p.content })),
        );
    }
  }
}

function ended(status: JobRunStatus, summary: string | null): AgentStepResult {
  const text = summary ?? 'This job run has ended';
  return status === 'done' ? { kind: 'finish', output: { summary: text } } : { kind: 'stop', reason: text };
}

const actorOf = (ctx: TaskContext): Actor => ({ id: ctx.agent.id, kind: 'agent' });

/** "Reply to enquiries: Draft a WhatsApp message to Ravi." */
function rationale(job: JobDef, pack: ResolvedPack, act: Act): string {
  const said = forPeople(narrateStep({ tool: act.tool, status: 'planned', args: act.args, pack }).text);
  return `${job.name}: ${said}${/[.!?]$/.test(said) ? '' : '.'}`;
}

function waitingOn(state: JobRunState): Waiting | null {
  const w = state.results[WAITING] as Partial<Waiting> | undefined;
  return w && typeof w.toolCallId === 'string' && typeof w.as === 'string' ? { toolCallId: w.toolCallId, as: w.as, step: Number(w.step) } : null;
}

function withoutWaiting(state: JobRunState): JobRunState {
  const { [WAITING]: _waiting, ...results } = state.results;
  return { ...state, results };
}

function withSeen(state: JobRunState, keys: string[]): JobRunState {
  if (!keys.length) return state;
  const had = Array.isArray(state.results[SEEN]) ? (state.results[SEEN] as string[]) : [];
  return { ...state, results: { ...state.results, [SEEN]: [...new Set([...had, ...keys])] } };
}

/** The words the escalate check that stopped the run looked at. */
function incomingWords(job: JobDef, state: JobRunState, ctx: JobContext): string {
  const check = job.steps[state.next]?.check?.escalate;
  if (!check) return '';
  return asText(fillTemplate(check.text, { trigger: ctx.trigger, today: ctx.today, ...state.results }).value);
}

/** Who to answer: the case's requester, or the requester the trigger carries. */
async function requesterOf(tx: Tx, run: RunRow): Promise<Partial<Requester> | null> {
  if (run.caseId) {
    const [c] = await tx.select({ requester: cases.requester }).from(cases).where(eq(cases.id, run.caseId));
    if (c) return c.requester;
  }
  const r = run.input.requester;
  if (!r || typeof r !== 'object') return null;
  const pick = (k: string) => {
    const v = (r as Record<string, unknown>)[k];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  return { name: pick('name'), phone: pick('phone'), email: pick('email') };
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : (JSON.stringify(v) ?? ''));

/** `openPermits` becomes `open permits`. */
function plain(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
}
