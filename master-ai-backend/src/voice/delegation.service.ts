import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type {
  CallOutcome,
  CallRecord,
  CallSettings,
  CallStage,
  Delegation,
  DelegationStatus,
  TranscriptLine,
} from '@onehuman/schemas';
import { AuditService, SYSTEM } from '../audit/audit.service';
import type { Session } from '../common/auth';
import { DEFAULT_TENANT_SETTINGS, truncate } from '../common/mappers';
import { DbService, type Tx } from '../db/db.service';
import { calls, delegations, goals, principals, staff, tasks, tenants, toolCalls, workspaces } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { addFeedback, loadTaskContext } from '../orchestration/context';
import { TemporalService } from '../orchestration/temporal.service';
import { CallEngine, simulatedReply, type CallContext } from './engine';
import { TeamService } from './team.service';
import { defaultDue, followUpTime, nextCallableTime, parseDue } from './time';

export interface CallResult {
  answered: boolean;
  outcome: CallOutcome | null;
  dueAt: string | null;
  notes: string | null;
  summary: string | null;
}

export interface DelegationResult {
  delegationId: string;
  status: DelegationStatus;
  summary: string;
  notes: string | null;
  dueAt: string | null;
  staff: { name: string; title: string };
  calls: number;
}

const ESCALATE: DelegationStatus[] = ['declined', 'blocked', 'not_done', 'unreachable'];

/**
 * Delegation by phone: the agent hands work to the person in charge, then a
 * durable workflow calls them to assign it, follow up and confirm it is done.
 * Calls go through a provider; today that is the simulator, which either
 * answers by itself (auto) or rings in the web app for a person to answer
 * as the staff member (interactive).
 */
@Injectable()
export class DelegationService {
  private readonly logger = new Logger(DelegationService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly engine: CallEngine,
    private readonly team: TeamService,
    private readonly temporal: TemporalService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- called from the task workflow ----------

  /** Create the delegation for an allowed `staff.delegate` call. Returns null when nobody fits. */
  async start(tenantId: string, taskId: string, toolCallId: string): Promise<{ delegationId: string | null }> {
    return this.db.tenant(tenantId, async (tx) => {
      const ctx = await loadTaskContext(tx, taskId);
      const [call] = await tx.select().from(toolCalls).where(eq(toolCalls.id, toolCallId));
      if (!call) throw new Error(`Tool call ${toolCallId} not found`);
      const [existing] = await tx.select().from(delegations).where(eq(delegations.toolCallId, toolCallId));
      if (existing) return { delegationId: existing.id };

      const args = call.args as { assignee: string; task: string; details?: string; due?: string };
      const person = await this.team.resolveAssignee(tx, args.assignee, args.task);
      if (!person) {
        const team = await this.team.directory(tx);
        const message = team.length
          ? `No team member matches "${args.assignee}". Team: ${team.map((p) => `${p.name} (${p.title}: ${p.responsibilities.join(', ')})`).join('; ')}`
          : 'There is nobody in the team directory yet. Ask the owner to add the people in charge under Team.';
        await tx.update(toolCalls).set({ status: 'failed', error: message }).where(eq(toolCalls.id, toolCallId));
        await addFeedback(tx, taskId, { source: 'tool', text: message });
        return { delegationId: null };
      }

      const dueFromArgs = args.due ? new Date(args.due) : null;
      const dueAt = dueFromArgs && !Number.isNaN(dueFromArgs.getTime()) ? dueFromArgs : parseDue(args.task);
      const title = truncate(args.task.split(/(?<=[.!?])\s/)[0]!.replace(/[.!?]$/, ''), 90);
      const [d] = await tx
        .insert(delegations)
        .values({
          tenantId,
          goalId: ctx.goal.id,
          taskId,
          toolCallId,
          staffId: person.id,
          title,
          instructions: [args.task, args.details].filter(Boolean).join(' '),
          dueAt,
        })
        .returning();
      await tx.update(toolCalls).set({ status: 'running' }).where(eq(toolCalls.id, toolCallId));
      await tx
        .update(tasks)
        .set({ status: 'waiting_on_team', waitingOn: `Waiting on ${person.name} (${person.title}): ${title}` })
        .where(eq(tasks.id, taskId));
      await this.audit.append(tx, tenantId, {
        type: 'delegation.created',
        actor: { id: ctx.agent.id, kind: 'agent' },
        goalId: ctx.goal.id,
        taskId,
        refId: d!.id,
        payload: { staffName: person.name, staffTitle: person.title, title, dueAt: dueAt?.toISOString() ?? null },
      });
      return { delegationId: d!.id };
    });
  }

  /** Record the delegation outcome as the tool call's result; the agent continues from there. */
  async finishAction(tenantId: string, taskId: string, toolCallId: string, result: DelegationResult) {
    await this.db.tenant(tenantId, async (tx) => {
      const ctx = await loadTaskContext(tx, taskId);
      await tx.update(toolCalls).set({ status: 'executed', result, executedAt: new Date() }).where(eq(toolCalls.id, toolCallId));
      await tx.update(tasks).set({ status: 'running', waitingOn: null }).where(eq(tasks.id, taskId));
      if (ESCALATE.includes(result.status)) {
        await addFeedback(tx, taskId, {
          source: 'tool',
          text: `Delegation to ${result.staff.name} ended as ${result.status}: ${result.summary} Decide whether to delegate to someone else or hand off to the owner.`,
        });
      }
      await this.audit.append(tx, tenantId, {
        type: 'action.executed',
        actor: { id: ctx.agent.id, kind: 'agent' },
        goalId: ctx.goal.id,
        taskId,
        refId: toolCallId,
        payload: { tool: 'staff.delegate', result: { status: result.status, summary: result.summary } },
      });
    });
  }

  // ---------- delegation workflow activities ----------

  async plan(tenantId: string): Promise<{ maxAttempts: number; retryMs: number; ringTimeoutMs: number; talkTimeoutMs: number }> {
    const s = await this.settings(tenantId);
    return {
      maxAttempts: s.maxAttempts,
      retryMs: s.fastSchedule ? 5_000 : s.retryMinutes * 60_000,
      ringTimeoutMs: 45_000,
      talkTimeoutMs: 15 * 60_000,
    };
  }

  /** Milliseconds to wait before the next call may be placed (working hours, kill switch). 0 = call now. */
  async waitBeforeCall(tenantId: string, delegationId: string): Promise<number> {
    return this.db.tenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ d: delegations, person: staff, tenant: tenants, ws: workspaces })
        .from(delegations)
        .innerJoin(staff, eq(staff.id, delegations.staffId))
        .innerJoin(tenants, eq(tenants.id, delegations.tenantId))
        .innerJoin(goals, eq(goals.id, delegations.goalId))
        .innerJoin(workspaces, eq(workspaces.id, goals.workspaceId))
        .where(eq(delegations.id, delegationId));
      if (!row) throw new Error(`Delegation ${delegationId} not found`);
      const s = { ...DEFAULT_TENANT_SETTINGS.calls, ...row.tenant.settings.calls };
      if (row.tenant.status === 'paused' || row.ws.status === 'paused') return s.fastSchedule ? 5_000 : 5 * 60_000;
      if (s.fastSchedule) return 0;
      const now = new Date();
      return Math.max(0, nextCallableTime(now, row.person.workingHours).getTime() - now.getTime());
    });
  }

  /** Place one call. In auto mode the simulated person answers and the result comes back at once. */
  async placeCall(tenantId: string, delegationId: string, stage: CallStage, attempt: number): Promise<{ callId: string; result: CallResult | null }> {
    const s = await this.settings(tenantId);
    const { callId, ctx } = await this.db.tenant(tenantId, async (tx) => {
      const d = await this.delegation(tx, delegationId);
      const [call] = await tx
        .insert(calls)
        .values({ tenantId, delegationId, staffId: d.staffId, stage, attempt, status: 'ringing', provider: s.provider })
        .returning();
      await tx
        .update(delegations)
        .set({ stage, nextCallAt: null, updatedAt: new Date(), ...(stage !== 'assign' && { status: 'in_progress' as const }) })
        .where(eq(delegations.id, delegationId));
      const ctx = await this.context(tx, delegationId, stage, []);
      await this.audit.append(tx, tenantId, {
        type: 'call.ringing',
        actor: SYSTEM,
        goalId: d.goalId,
        taskId: d.taskId,
        refId: call!.id,
        payload: { staffName: ctx.staff.name, stage, attempt, mode: s.simulatorMode },
      });
      return { callId: call!.id, ctx };
    });

    if (s.simulatorMode === 'interactive') return { callId, result: null };

    // Auto mode: a simulated team member answers.
    let transcript: TranscriptLine[] = [line('ai', this.engine.opening(ctx))];
    await this.db.tenant(tenantId, (tx) => tx.update(calls).set({ status: 'in_progress', startedAt: new Date(), transcript }).where(eq(calls.id, callId)));
    for (let turn = 0; turn < 4; turn++) {
      const reply = simulatedReply(ctx);
      const res = await this.engine.turn({ ...ctx, transcript }, reply);
      transcript = [...transcript, line('person', reply), line('ai', res.say)];
      if (res.end || turn === 3) {
        await this.finalize(tenantId, callId, transcript, res.outcome ?? 'unclear', res.dueAt, res.notes);
        break;
      }
    }
    return { callId, result: await this.callResult(tenantId, callId) };
  }

  async callResult(tenantId: string, callId: string): Promise<CallResult> {
    return this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, callId));
      if (!c) throw new Error(`Call ${callId} not found`);
      return {
        answered: c.status === 'completed',
        outcome: c.outcome,
        dueAt: c.extracted.dueAt ?? null,
        notes: c.extracted.notes ?? null,
        summary: c.summary,
      };
    });
  }

  /** Nobody picked up (or the call was cut off): record it so the workflow can retry. */
  async markNoAnswer(tenantId: string, callId: string) {
    const [c] = await this.db.tenant(tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, callId)));
    if (!c) return;
    if (c.status === 'in_progress') {
      await this.finalize(tenantId, callId, c.transcript, 'unclear', null, 'The call ended before an answer was reached.');
      return;
    }
    if (c.status !== 'ringing') return;
    await this.db.tenant(tenantId, async (tx) => {
      const d = await this.delegation(tx, c.delegationId);
      const [person] = await tx.select().from(staff).where(eq(staff.id, c.staffId));
      await tx.update(calls).set({ status: 'no_answer', endedAt: new Date(), outcome: 'no_answer', summary: `${person?.name ?? 'They'} didn't answer.` }).where(eq(calls.id, callId));
      await this.audit.append(tx, tenantId, {
        type: 'call.no_answer',
        actor: SYSTEM,
        goalId: d.goalId,
        taskId: d.taskId,
        refId: callId,
        payload: { staffName: person?.name, stage: c.stage, attempt: c.attempt },
      });
    });
  }

  /** How long to wait before the next stage's call, and remember when it will be. */
  async scheduleNext(tenantId: string, delegationId: string, stage: 'follow_up' | 'confirm'): Promise<number> {
    const s = await this.settings(tenantId);
    return this.db.tenant(tenantId, async (tx) => {
      const d = await this.delegation(tx, delegationId);
      const now = new Date();
      const due = d.dueAt ?? defaultDue(now);
      const at = s.fastSchedule
        ? new Date(now.getTime() + 20_000)
        : stage === 'follow_up'
          ? followUpTime(now, due)
          : new Date(Math.max(due.getTime(), now.getTime() + 60_000));
      await tx.update(delegations).set({ nextCallAt: at, stage, updatedAt: now }).where(eq(delegations.id, delegationId));
      return at.getTime() - now.getTime();
    });
  }

  /** Apply what a call established (accepted with a deadline, on track, more time). */
  async applyOutcome(tenantId: string, delegationId: string, result: CallResult) {
    await this.db.tenant(tenantId, async (tx) => {
      const d = await this.delegation(tx, delegationId);
      const status: DelegationStatus = result.outcome === 'accepted' ? 'accepted' : 'in_progress';
      const dueAt = result.dueAt ? new Date(result.dueAt) : d.dueAt;
      await tx.update(delegations).set({ status, dueAt, updatedAt: new Date() }).where(eq(delegations.id, delegationId));
      const [person] = await tx.select().from(staff).where(eq(staff.id, d.staffId));
      await tx
        .update(tasks)
        .set({ waitingOn: `${person?.name ?? 'Team'}: ${result.summary ?? status}` })
        .where(eq(tasks.id, d.taskId));
      await this.audit.append(tx, tenantId, {
        type: 'delegation.updated',
        actor: SYSTEM,
        goalId: d.goalId,
        taskId: d.taskId,
        refId: delegationId,
        payload: { staffName: person?.name, status, title: d.title, dueAt: dueAt?.toISOString() ?? null, summary: result.summary },
      });
    });
  }

  /** Close the delegation and hand the result back to the agent. Bad outcomes notify the owner. */
  async close(tenantId: string, delegationId: string, status: DelegationStatus, result: CallResult | null): Promise<DelegationResult> {
    const out = await this.db.tenant(tenantId, async (tx) => {
      const d = await this.delegation(tx, delegationId);
      const [person] = await tx.select().from(staff).where(eq(staff.id, d.staffId));
      const callRows = await tx.select().from(calls).where(eq(calls.delegationId, delegationId));
      const name = person?.name ?? 'The team member';
      const summary =
        result?.summary ??
        (status === 'unreachable' ? `Could not reach ${name} after ${callRows.length} call attempts.` : `${name}: ${status.replace('_', ' ')}.`);
      const dueAt = result?.dueAt ? new Date(result.dueAt) : d.dueAt;
      await tx
        .update(delegations)
        .set({ status, stage: 'closed', nextCallAt: null, outcome: { summary, notes: result?.notes ?? null }, dueAt, completedAt: new Date(), updatedAt: new Date() })
        .where(eq(delegations.id, delegationId));
      await this.audit.append(tx, tenantId, {
        type: 'delegation.updated',
        actor: SYSTEM,
        goalId: d.goalId,
        taskId: d.taskId,
        refId: delegationId,
        payload: { staffName: name, status, title: d.title, summary },
      });
      return {
        delegationId,
        status,
        summary,
        notes: result?.notes ?? null,
        dueAt: dueAt?.toISOString() ?? null,
        staff: { name, title: person?.title ?? '' },
        calls: callRows.length,
      } satisfies DelegationResult;
    });
    if (ESCALATE.includes(status)) {
      void this.notifications.pushToTenant(tenantId, { title: `Needs you: ${out.staff.name}`, body: out.summary, data: { delegationId } });
    }
    return out;
  }

  // ---------- interactive simulator (API) ----------

  /** Calls ringing or in progress, for the web phone simulator. */
  async active(tenantId: string): Promise<CallRecord[]> {
    return this.listCalls(tenantId, { statuses: ['ringing', 'in_progress'] });
  }

  async answer(session: Session, callId: string): Promise<CallRecord> {
    const delegationId = await this.db.tenant(session.tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, callId)).for('update');
      if (!c) throw new NotFoundException('Call not found');
      if (c.status !== 'ringing') throw new ConflictException(`Call is ${c.status.replace('_', ' ')}`);
      const ctx = await this.context(tx, c.delegationId, c.stage, []);
      await tx.update(calls).set({ status: 'in_progress', startedAt: new Date(), transcript: [line('ai', this.engine.opening(ctx))] }).where(eq(calls.id, callId));
      return c.delegationId;
    });
    await this.temporal.signalCall(delegationId, { callId, event: 'answered' });
    return this.getCall(session.tenantId, callId);
  }

  async reply(session: Session, callId: string, text: string): Promise<CallRecord> {
    const { c, ctx } = await this.db.tenant(session.tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, callId));
      if (!c) throw new NotFoundException('Call not found');
      if (c.status !== 'in_progress') throw new BadRequestException('Answer the call first');
      return { c, ctx: await this.context(tx, c.delegationId, c.stage, c.transcript) };
    });
    const res = await this.engine.turn(ctx, text);
    const transcript = [...c.transcript, line('person', text), line('ai', res.say)];
    if (res.end) {
      await this.finalize(session.tenantId, callId, transcript, res.outcome ?? 'unclear', res.dueAt, res.notes);
      await this.temporal.signalCall(c.delegationId, { callId, event: 'ended' });
    } else {
      await this.db.tenant(session.tenantId, (tx) => tx.update(calls).set({ transcript }).where(eq(calls.id, callId)));
    }
    return this.getCall(session.tenantId, callId);
  }

  async decline(session: Session, callId: string): Promise<CallRecord> {
    const [c] = await this.db.tenant(session.tenantId, (tx) => tx.select().from(calls).where(eq(calls.id, callId)));
    if (!c) throw new NotFoundException('Call not found');
    await this.markNoAnswer(session.tenantId, callId);
    await this.temporal.signalCall(c.delegationId, { callId, event: 'ended' });
    return this.getCall(session.tenantId, callId);
  }

  // ---------- reads ----------

  async listCalls(tenantId: string, opts: { statuses?: CallRecord['status'][]; limit?: number } = {}): Promise<CallRecord[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ c: calls, person: staff, d: delegations })
        .from(calls)
        .innerJoin(staff, eq(staff.id, calls.staffId))
        .innerJoin(delegations, eq(delegations.id, calls.delegationId))
        .where(opts.statuses ? inArray(calls.status, opts.statuses) : undefined)
        .orderBy(desc(calls.createdAt))
        .limit(opts.limit ?? 100);
      return rows.map((r) => toCall(r.c, r.person, r.d.title));
    });
  }

  async getCall(tenantId: string, callId: string): Promise<CallRecord> {
    const rows = await this.db.tenant(tenantId, (tx) =>
      tx
        .select({ c: calls, person: staff, d: delegations })
        .from(calls)
        .innerJoin(staff, eq(staff.id, calls.staffId))
        .innerJoin(delegations, eq(delegations.id, calls.delegationId))
        .where(eq(calls.id, callId)),
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('Call not found');
    return toCall(r.c, r.person, r.d.title);
  }

  async listDelegations(tenantId: string, goalId?: string): Promise<Delegation[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ d: delegations, person: staff })
        .from(delegations)
        .innerJoin(staff, eq(staff.id, delegations.staffId))
        .where(goalId ? eq(delegations.goalId, goalId) : undefined)
        .orderBy(desc(delegations.createdAt))
        .limit(100);
      const callRows = rows.length
        ? await tx.select().from(calls).where(inArray(calls.delegationId, rows.map((r) => r.d.id))).orderBy(calls.createdAt)
        : [];
      return rows.map(({ d, person }) => ({
        id: d.id,
        goalId: d.goalId,
        taskId: d.taskId,
        toolCallId: d.toolCallId,
        staffId: d.staffId,
        staffName: person.name,
        staffTitle: person.title,
        title: d.title,
        instructions: d.instructions,
        dueAt: d.dueAt?.toISOString() ?? null,
        status: d.status,
        stage: d.stage,
        nextCallAt: d.nextCallAt?.toISOString() ?? null,
        outcome: d.outcome ?? null,
        calls: callRows.filter((c) => c.delegationId === d.id).map((c) => toCall(c, person, d.title)),
        createdAt: d.createdAt.toISOString(),
        completedAt: d.completedAt?.toISOString() ?? null,
      }));
    });
  }

  // ---------- internals ----------

  private async finalize(tenantId: string, callId: string, transcript: TranscriptLine[], outcome: CallOutcome, dueAt: Date | null, notes: string | null) {
    await this.db.tenant(tenantId, async (tx) => {
      const [c] = await tx.select().from(calls).where(eq(calls.id, callId));
      if (!c) return;
      const ctx = await this.context(tx, c.delegationId, c.stage, transcript);
      const summary = this.engine.summarize(ctx, outcome, dueAt, notes);
      await tx
        .update(calls)
        .set({ status: 'completed', endedAt: new Date(), transcript, outcome, summary, extracted: { dueAt: dueAt?.toISOString() ?? null, notes } })
        .where(eq(calls.id, callId));
      const d = await this.delegation(tx, c.delegationId);
      await this.audit.append(tx, tenantId, {
        type: 'call.completed',
        actor: SYSTEM,
        goalId: d.goalId,
        taskId: d.taskId,
        refId: callId,
        payload: { staffName: ctx.staff.name, stage: c.stage, outcome, summary },
      });
    });
  }

  private async delegation(tx: Tx, id: string) {
    const [d] = await tx.select().from(delegations).where(eq(delegations.id, id));
    if (!d) throw new Error(`Delegation ${id} not found`);
    return d;
  }

  private async context(tx: Tx, delegationId: string, stage: CallStage, transcript: TranscriptLine[]): Promise<CallContext> {
    const [row] = await tx
      .select({ d: delegations, person: staff, tenant: tenants })
      .from(delegations)
      .innerJoin(staff, eq(staff.id, delegations.staffId))
      .innerJoin(tenants, eq(tenants.id, delegations.tenantId))
      .where(eq(delegations.id, delegationId));
    if (!row) throw new Error(`Delegation ${delegationId} not found`);
    const [owner] = await tx
      .select({ name: principals.displayName })
      .from(principals)
      .where(and(eq(principals.kind, 'human'), eq(principals.role, 'owner')))
      .limit(1);
    return {
      tenantId: row.d.tenantId,
      goalId: row.d.goalId,
      taskId: row.d.taskId,
      companyName: row.tenant.name,
      ownerName: owner?.name ?? 'the owner',
      staff: { name: row.person.name, title: row.person.title },
      stage,
      task: { title: row.d.title, instructions: row.d.instructions, dueAt: row.d.dueAt },
      transcript,
    };
  }

  private async settings(tenantId: string): Promise<CallSettings> {
    const [t] = await this.db.tenant(tenantId, (tx) => tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)));
    return { ...DEFAULT_TENANT_SETTINGS.calls, ...t?.settings.calls };
  }
}

function line(speaker: TranscriptLine['speaker'], text: string): TranscriptLine {
  return { speaker, text, at: new Date().toISOString() };
}

function toCall(c: typeof calls.$inferSelect, person: typeof staff.$inferSelect, delegationTitle: string): CallRecord {
  return {
    id: c.id,
    delegationId: c.delegationId,
    staffId: c.staffId,
    staffName: person.name,
    staffTitle: person.title,
    stage: c.stage,
    attempt: c.attempt,
    status: c.status,
    provider: c.provider,
    scheduledFor: c.scheduledFor.toISOString(),
    startedAt: c.startedAt?.toISOString() ?? null,
    endedAt: c.endedAt?.toISOString() ?? null,
    durationSec: c.startedAt && c.endedAt ? Math.round((c.endedAt.getTime() - c.startedAt.getTime()) / 1000) : null,
    transcript: c.transcript,
    summary: c.summary,
    outcome: c.outcome,
    extracted: c.extracted,
    delegationTitle,
    createdAt: c.createdAt.toISOString(),
  };
}
