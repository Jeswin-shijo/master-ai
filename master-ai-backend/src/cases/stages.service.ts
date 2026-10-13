import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import { STAGE_KEYS, type CaseFile, type CaseStageStatus, type CaseStatus } from '@onehuman/schemas';
import {
  caseGoalText,
  isUntrusted,
  isUrgent,
  mergeAssign,
  mergeClassify,
  mergeReview,
  mergeVerify,
  offlineAssign,
  offlineClassify,
  offlineReport,
  offlineReview,
  offlineVerify,
  resolveTool,
  roleName,
  stageSummary,
  withPreset,
  type TeamMember,
} from '@onehuman/agent-kit';
import { routeApprover } from '../approvals/may-decide';
import { AuditService, SYSTEM } from '../audit/audit.service';
import { DbService, type Tx } from '../db/db.service';
import { approvalRequests, cases, caseStages, goals, principals, tasks } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { stageWorkflowId, type CaseEnding, type GateName, type GateOpened, type StageRunResult, type StageWorkflowInput } from '../orchestration/shared';
import { PolicyService } from '../policy/policy.service';
import { ReportsService } from '../reports/reports.service';
import { TeamService } from '../voice/team.service';
import { loadCaseContext, type CaseContext } from './case-context';
import { StageModel } from './stage-model';

const COORDINATOR = 'Case coordinator';
const RULES = 'Case coordinator (rules)';
const FINAL: CaseStatus[] = ['closed', 'rejected', 'cancelled', 'escalated'];
const OPEN_STAGE: CaseStageStatus[] = ['pending', 'running', 'needs_info', 'waiting_approval'];
const STATUS_AT_START: Partial<Record<StageWorkflowInput['stage'], CaseStatus>> = {
  request: 'open',
  review: 'open',
  classify: 'open',
  assign: 'open',
  approve: 'open',
  execute: 'in_progress',
  close: 'in_progress',
};
const OUTCOME_WORD: Record<CaseEnding, string> = { closed: 'resolved', rejected: 'rejected', cancelled: 'cancelled', escalated: 'escalated' };

type CaseSet = Partial<typeof cases.$inferInsert>;
interface SaveInput {
  part?: Partial<CaseFile>;
  caseSet?: CaseSet;
  status: CaseStageStatus;
  summary: string;
  actor: string;
  output?: Record<string, unknown>;
}

const firstLine = (text: string) => text.split('\n')[0]!.replace(/^•\s*/, '').trim();

function pausedNow(ctx: CaseContext): boolean {
  return ctx.tenant.status !== 'active' || ctx.workspace.status !== 'active' || (ctx.coordinator !== null && ctx.coordinator.status !== 'active');
}

/** The work of each stage. Each method is a Temporal activity, safe to retry. */
@Injectable()
export class CaseStagesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly model: StageModel,
    private readonly team: TeamService,
    private readonly reports: ReportsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- bookkeeping ----------

  /** Mark the stage running (once) and say whether a kill switch holds it. */
  async beginStage(i: StageWorkflowInput): Promise<{ paused: boolean }> {
    return this.db.tenant(i.tenantId, async (tx) => {
      const ctx = await loadCaseContext(tx, i.caseId);
      const name = ctx.lc.stages.find((s) => s.key === i.stage)!.name;
      const [inserted] = await tx
        .insert(caseStages)
        .values({
          tenantId: i.tenantId,
          caseId: i.caseId,
          stage: i.stage,
          attempt: i.attempt,
          name,
          status: 'running',
          workflowId: stageWorkflowId(i.caseId, i.stage, i.attempt),
          startedAt: new Date(),
          input: i.reworkNote ? { reworkNote: i.reworkNote } : null,
        })
        .onConflictDoNothing({ target: [caseStages.caseId, caseStages.stage, caseStages.attempt] })
        .returning();
      const status = STATUS_AT_START[i.stage];
      if (!FINAL.includes(ctx.caseRow.status)) {
        await tx.update(cases).set({ stage: i.stage, ...(status && { status }), updatedAt: new Date() }).where(eq(cases.id, i.caseId));
      }
      if (inserted) {
        await this.audit.append(tx, i.tenantId, {
          type: 'case.stage_started',
          actor: SYSTEM,
          refId: i.caseId,
          payload: { code: ctx.caseRow.code, stage: i.stage, stageName: name, attempt: i.attempt },
        });
      }
      return { paused: pausedNow(ctx) };
    });
  }

  async isPaused(i: StageWorkflowInput): Promise<boolean> {
    return this.db.tenant(i.tenantId, async (tx) => pausedNow(await loadCaseContext(tx, i.caseId)));
  }

  /** End a stage that stopped without its own result (cancelled, timed out). */
  async completeStage(i: StageWorkflowInput & { status: 'done' | 'skipped' | 'failed'; summary?: string }) {
    await this.db.tenant(i.tenantId, async (tx) => {
      const ctx = await loadCaseContext(tx, i.caseId);
      const [row] = await tx
        .update(caseStages)
        .set({ status: i.status, ...(i.summary && { summary: i.summary }), completedAt: new Date() })
        .where(and(eq(caseStages.caseId, i.caseId), eq(caseStages.stage, i.stage), eq(caseStages.attempt, i.attempt), inArray(caseStages.status, OPEN_STAGE)))
        .returning();
      if (row) {
        await this.audit.append(tx, i.tenantId, {
          type: 'case.stage_completed',
          actor: SYSTEM,
          refId: i.caseId,
          payload: { code: ctx.caseRow.code, stage: i.stage, stageName: row.name, status: i.status, summary: row.summary },
        });
      }
    });
  }

  /** Save a stage's part, case columns, sentence and status together. */
  private async save(tx: Tx, ctx: CaseContext, i: StageWorkflowInput, s: SaveInput) {
    if (s.part || s.caseSet) {
      await tx
        .update(cases)
        .set({
          ...(s.part && { file: sql`${cases.file} || ${JSON.stringify(s.part)}::jsonb` }),
          ...s.caseSet,
          updatedAt: new Date(),
        })
        .where(eq(cases.id, i.caseId));
    }
    const final = s.status === 'done' || s.status === 'skipped' || s.status === 'failed';
    const output = s.output ?? (s.part?.[i.stage] as Record<string, unknown> | undefined);
    const [row] = await tx
      .update(caseStages)
      .set({ status: s.status, summary: s.summary, actor: s.actor, ...(output && { output }), ...(final && { completedAt: new Date() }) })
      .where(and(eq(caseStages.caseId, i.caseId), eq(caseStages.stage, i.stage), eq(caseStages.attempt, i.attempt)))
      .returning();
    if (final) {
      await this.audit.append(tx, i.tenantId, {
        type: 'case.stage_completed',
        actor: SYSTEM,
        refId: i.caseId,
        payload: { code: ctx.caseRow.code, stage: i.stage, stageName: row?.name ?? i.stage, status: s.status, summary: s.summary, actor: s.actor },
      });
    }
  }

  // ---------- stages run by rules (and the model) ----------

  async runStage(i: StageWorkflowInput): Promise<StageRunResult> {
    const ctx = await this.db.tenant(i.tenantId, (tx) => loadCaseContext(tx, i.caseId));
    switch (i.stage) {
      case 'request':
        await this.db.tenant(i.tenantId, (tx) =>
          this.save(tx, ctx, i, { status: 'done', summary: stageSummary('request', ctx.caseRow.file, ctx.lc), actor: RULES, output: { ...ctx.caseRow.file.request } }),
        );
        return { outcome: 'done' };
      case 'review':
        return this.review(i, ctx);
      case 'classify':
        return this.classify(i, ctx);
      case 'assign':
        return this.assign(i, ctx);
      case 'report':
        return this.report(i, ctx);
      default:
        throw new Error(`runStage does not run the ${i.stage} stage`);
    }
  }

  private async review(i: StageWorkflowInput, ctx: CaseContext): Promise<StageRunResult> {
    const file = ctx.caseRow.file;
    const request = file.request!;
    const offline = offlineReview(withPreset(ctx.lc, request), request, request.amountInr);
    const asked = await this.model.ask('review', ctx, { file, now: new Date().toISOString() });
    const part = mergeReview(ctx.lc, request, asked.output, offline);
    const actor = asked.output ? COORDINATOR : RULES;
    const missing = part.missing.map((m) => m.label.toLowerCase()).join(', ');
    // P1 cases never wait for details: the work starts while we ask.
    const urgent = isUrgent(ctx.lc, request.text) || ctx.lc.categories.find((c) => c.id === part.provisionalCategory)?.priority === 'P1';
    const asking = part.outcome === 'needs_info';

    if (asking && !urgent) {
      await this.db.tenant(i.tenantId, async (tx) => {
        await this.save(tx, ctx, i, { part: { review: part }, caseSet: { status: 'needs_info' }, status: 'needs_info', summary: stageSummary('review', { ...file, review: part }, ctx.lc), actor });
        await this.audit.append(tx, i.tenantId, { type: 'case.needs_info', actor: SYSTEM, refId: i.caseId, payload: { code: ctx.caseRow.code, missing } });
      });
      void this.notifications.pushToTenant(i.tenantId, { title: 'More details needed', body: `${ctx.caseRow.code}: ${missing}`, data: { caseId: i.caseId } });
      return { outcome: 'needs_info', waitMs: ctx.tenant.settings.needsInfoDays * 86_400_000 };
    }

    const summary = asking ? `Urgent, so the work starts now while we ask for: ${missing}.` : stageSummary('review', { ...file, review: part }, ctx.lc);
    await this.db.tenant(i.tenantId, async (tx) => {
      await this.save(tx, ctx, i, { part: { review: part }, caseSet: { status: 'open' }, status: 'done', summary, actor });
      if (asking) await this.audit.append(tx, i.tenantId, { type: 'case.needs_info', actor: SYSTEM, refId: i.caseId, payload: { code: ctx.caseRow.code, missing, urgent: true } });
    });
    if (asking) void this.notifications.pushToTenant(i.tenantId, { title: 'More details needed (work has started)', body: `${ctx.caseRow.code}: ${missing}`, data: { caseId: i.caseId } });
    return part.outcome === 'not_eligible' ? { outcome: 'not_eligible', reason: `Not eligible: ${part.reason ?? 'it does not meet the rules'}` } : { outcome: 'done' };
  }

  private async classify(i: StageWorkflowInput, ctx: CaseContext): Promise<StageRunResult> {
    const file = ctx.caseRow.file;
    const request = file.request!;
    const now = new Date();
    const offline = offlineClassify(withPreset(ctx.lc, request), request, now, request.amountInr);
    const asked = await this.model.ask('classify', ctx, { file, now: now.toISOString() });
    const part = mergeClassify(ctx.lc, request, now, asked.output, offline);
    await this.db.tenant(i.tenantId, (tx) =>
      this.save(tx, ctx, i, {
        part: { classify: part },
        caseSet: {
          category: part.category,
          categoryName: part.categoryName,
          priority: part.priority,
          risk: part.risk,
          department: part.department,
          amountInr: part.amountInr,
          respondBy: new Date(part.respondBy),
          resolveBy: new Date(part.resolveBy),
        },
        status: 'done',
        summary: stageSummary('classify', { ...file, classify: part }, ctx.lc),
        actor: asked.output ? COORDINATOR : RULES,
      }),
    );
    return { outcome: 'done' };
  }

  private async assign(i: StageWorkflowInput, ctx: CaseContext): Promise<StageRunResult> {
    const file = ctx.caseRow.file;
    const classify = file.classify!;
    const team: TeamMember[] = await this.db.tenant(i.tenantId, async (tx) =>
      (await this.team.directory(tx)).map((s) => ({ id: s.id, name: s.name, title: s.title, responsibilities: s.responsibilities })),
    );
    const offline = offlineAssign(ctx.lc, classify, team);
    const asked = await this.model.ask('assign', ctx, { file, now: new Date().toISOString(), team });
    const part = mergeAssign(asked.output, offline, team, classify);
    await this.db.tenant(i.tenantId, (tx) =>
      this.save(tx, ctx, i, { part: { assign: part }, caseSet: { assignee: part.assignee }, status: 'done', summary: part.reason, actor: asked.output ? COORDINATOR : RULES }),
    );
    return { outcome: 'done' };
  }

  private async report(i: StageWorkflowInput, ctx: CaseContext): Promise<StageRunResult> {
    const c = ctx.caseRow;
    const { stageRows, sameCategory } = await this.db.tenant(i.tenantId, async (tx) => {
      const stageRows = await tx.select().from(caseStages).where(eq(caseStages.caseId, c.id)).orderBy(asc(caseStages.createdAt));
      const [count] = c.category
        ? await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(cases)
            .where(and(eq(cases.category, c.category), gte(cases.createdAt, new Date(Date.now() - 30 * 86_400_000))))
        : [{ n: 0 }];
      return { stageRows, sameCategory: count?.n ?? 0 };
    });
    const ending = (FINAL.includes(c.status) ? c.status : 'closed') as CaseEnding;
    const part = offlineReport({
      caseLabel: ctx.lc.case.label,
      number: c.code,
      title: c.title,
      ...(c.categoryName && { categoryName: c.categoryName }),
      outcome: OUTCOME_WORD[ending],
      stages: stageRows.map((s) => ({ key: s.stage, name: s.name, status: s.status, startedAt: s.startedAt?.toISOString() ?? null, completedAt: s.completedAt?.toISOString() ?? null })),
      createdAt: c.createdAt.toISOString(),
      resolveBy: c.resolveBy?.toISOString() ?? null,
      closedAt: (c.closedAt ?? new Date()).toISOString(),
      sameCategoryLast30Days: sameCategory,
    });
    await this.db.tenant(i.tenantId, (tx) => this.save(tx, ctx, i, { part: { report: part }, status: 'done', summary: part.text, actor: RULES }));
    return { outcome: 'done' };
  }

  // ---------- gates (stage 5 approval, stage 7 sign-off) ----------

  async openGate(i: StageWorkflowInput & { gate: GateName }): Promise<GateOpened> {
    const result = await this.db.tenant(i.tenantId, async (tx): Promise<{ opened: GateOpened; notify: string | null }> => {
      const ctx = await loadCaseContext(tx, i.caseId);
      const c = ctx.caseRow;
      const cls = c.file.classify;
      if (!cls) throw new Error(`Case ${c.code} has no classification`);
      if (!ctx.coordinator) throw new Error(`Case ${c.code}: the workspace has no case coordinator`);

      const [pending] = await tx
        .select()
        .from(approvalRequests)
        .where(and(eq(approvalRequests.caseId, c.id), eq(approvalRequests.stage, i.stage), eq(approvalRequests.status, 'pending')));
      if (pending) return { opened: { status: 'waiting', approvalId: pending.id, ttlMs: Math.max(0, pending.expiresAt.getTime() - Date.now()) }, notify: null };

      const toolName = i.gate === 'proceed' ? 'case.proceed' : 'case.close';
      const tool = resolveTool(ctx.pack, toolName);
      if (!tool) throw new Error(`${toolName} is not available in this workspace`);
      const args = { caseId: c.id, category: cls.category, priority: cls.priority, risk: cls.risk, summary: c.title, ...(cls.amountInr !== null && { amount: cls.amountInr }) };
      const decision = await this.policy.decide({
        tx,
        tool,
        args,
        agent: ctx.coordinator,
        workspace: { id: ctx.workspace.id, status: ctx.workspace.status },
        tenant: { id: ctx.tenant.id, status: ctx.tenant.status, settings: ctx.tenant.settings },
        moneySpentInr: 0,
        untrustedOrigin: false,
        caseContext: { category: cls.category, priority: cls.priority, risk: cls.risk, source: c.source },
      });
      await this.audit.append(tx, i.tenantId, {
        type: 'policy.decided',
        actor: SYSTEM,
        refId: c.id,
        payload: { tool: toolName, code: c.code, level: decision.level, riskScore: decision.riskScore, reasons: decision.reasons, policyVersion: decision.policyVersion },
      });

      if (decision.level <= 3) {
        await this.recordGate(tx, ctx, i, { required: false, decision: 'not_required' });
        return { opened: { status: 'not_required' }, notify: null };
      }
      if (decision.level === 5) {
        const reason = decision.reasons.join('; ') || 'The rules do not allow it';
        await this.recordGate(tx, ctx, i, { required: true, decision: 'blocked', notes: reason });
        return { opened: { status: 'blocked', reason }, notify: null };
      }

      const role = decision.approver ?? 'owner';
      const [holders] =
        role === 'owner'
          ? [{ n: 0 }]
          : await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(principals)
              .where(and(eq(principals.kind, 'human'), eq(principals.status, 'active'), sql`${principals.approverRoles} @> array[${role}]::text[]`));
      const route = routeApprover(role, holders?.n ?? 0, roleName(ctx.lc, role));
      const ttlMs = ctx.tenant.settings.approvalTtlHours * 3_600_000;
      const summary = `${i.gate === 'proceed' ? 'Approve' : 'Sign off'} ${cls.categoryName.toLowerCase()} for ${c.code} · ${c.title}`;
      const done = await tx
        .select()
        .from(caseStages)
        .where(and(eq(caseStages.caseId, c.id), eq(caseStages.status, 'done')))
        .orderBy(asc(caseStages.createdAt));
      const evidence = [
        ...done.filter((s) => s.summary).map((s) => ({ label: s.name, value: s.summary! })),
        ...(route.note ? [{ label: 'Why it came to you', value: route.note }] : []),
      ];
      const [approval] = await tx
        .insert(approvalRequests)
        .values({
          tenantId: i.tenantId,
          kind: 'case_gate',
          caseId: c.id,
          stage: i.stage,
          agentId: ctx.coordinator.id,
          tool: toolName,
          // People read these through readableFields: the case type in words, not its id.
          args: { ...args, category: cls.categoryName },
          summary,
          rationale: decision.reasons.join(' '),
          decision: { ...decision, reasons: route.note ? [...decision.reasons, route.note] : decision.reasons },
          evidence,
          costSoFarInr: 0,
          approver: route.approver,
          expiresAt: new Date(Date.now() + ttlMs),
        })
        .returning();
      const waitingFor = route.approver === 'owner' ? 'the owner' : `the ${roleName(ctx.lc, route.approver)}`;
      await this.save(tx, ctx, i, {
        caseSet: { status: i.gate === 'proceed' ? 'waiting_approval' : 'waiting_signoff' },
        status: 'waiting_approval',
        summary: `Waiting for ${waitingFor}.`,
        actor: COORDINATOR,
      });
      await this.audit.append(tx, i.tenantId, {
        type: 'approval.requested',
        actor: { id: ctx.coordinator.id, kind: 'agent' },
        refId: approval!.id,
        payload: { kind: 'case_gate', tool: toolName, summary, approver: route.approver, reasons: decision.reasons, caseId: c.id, code: c.code },
      });
      return { opened: { status: 'waiting', approvalId: approval!.id, ttlMs }, notify: summary };
    });
    if (result.notify && result.opened.status === 'waiting') {
      void this.notifications.pushToTenant(i.tenantId, { title: 'Approval needed', body: result.notify, data: { approvalId: result.opened.approvalId } });
    }
    return result.opened;
  }

  /** The gate's outcome: a person decided, or nobody did in time. */
  async closeGate(i: StageWorkflowInput & { gate: GateName; approvalId: string; decision: 'approved' | 'rejected' | 'expired'; notes?: string }) {
    await this.db.tenant(i.tenantId, async (tx) => {
      const ctx = await loadCaseContext(tx, i.caseId);
      if (i.decision === 'expired') {
        const [expired] = await tx
          .update(approvalRequests)
          .set({ status: 'expired' })
          .where(and(eq(approvalRequests.id, i.approvalId), eq(approvalRequests.status, 'pending')))
          .returning();
        if (expired) {
          await this.audit.append(tx, i.tenantId, {
            type: 'approval.expired',
            actor: SYSTEM,
            refId: i.approvalId,
            payload: { kind: 'case_gate', summary: expired.summary, caseId: i.caseId },
          });
        }
      }
      const [approval] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, i.approvalId));
      const [person] = approval?.decidedBy
        ? await tx.select({ name: principals.displayName }).from(principals).where(eq(principals.id, approval.decidedBy))
        : [];
      await this.recordGate(tx, ctx, i, {
        required: true,
        decision: i.decision,
        notes: i.notes ?? approval?.decisionNotes ?? undefined,
        decidedBy: person?.name,
        approvalId: i.approvalId,
        role: approval?.approver,
      });
    });
  }

  private async recordGate(
    tx: Tx,
    ctx: CaseContext,
    i: StageWorkflowInput & { gate: GateName },
    r: { required: boolean; decision: 'not_required' | 'approved' | 'rejected' | 'expired' | 'blocked'; notes?: string; decidedBy?: string; approvalId?: string; role?: string },
  ) {
    const file = ctx.caseRow.file;
    if (i.gate === 'proceed') {
      const approve = {
        required: r.required,
        ...(r.role && { approverRole: r.role }),
        decision: r.decision,
        ...(r.decidedBy && { decidedBy: r.decidedBy }),
        ...(r.notes && { notes: r.notes }),
        ...(r.approvalId && { approvalId: r.approvalId }),
      };
      await this.save(tx, ctx, i, {
        part: { approve },
        caseSet: { status: 'open' },
        status: r.decision === 'not_required' ? 'skipped' : 'done',
        summary: stageSummary('approve', { ...file, approve }, ctx.lc),
        actor: r.decidedBy ?? COORDINATOR,
      });
      return;
    }
    // Stage 7: verifyClose wrote the findings; the sign-off goes with them.
    const signoff = {
      required: r.required,
      ...(r.role && { role: r.role }),
      decision: r.decision === 'blocked' ? ('rejected' as const) : r.decision,
      ...(r.decidedBy && { by: r.decidedBy }),
    };
    const close = { ...file.close!, signoff };
    const ok = r.decision === 'approved' || r.decision === 'not_required';
    await this.save(tx, ctx, i, {
      part: { close },
      caseSet: { status: 'in_progress' },
      status: ok ? 'done' : 'failed',
      summary: ok ? stageSummary('close', { ...file, close }, ctx.lc) : `Sign-off ${r.decision === 'expired' ? 'expired' : 'refused'}${r.notes ? `: ${r.notes}` : '.'}`,
      actor: r.decidedBy ?? COORDINATOR,
    });
  }

  // ---------- stage 6: the work ----------

  async startExecution(i: StageWorkflowInput): Promise<{ goalId: string; workflowId: string }> {
    return this.db.tenant(i.tenantId, async (tx) => {
      const ctx = await loadCaseContext(tx, i.caseId);
      const [stage] = await tx
        .select()
        .from(caseStages)
        .where(and(eq(caseStages.caseId, i.caseId), eq(caseStages.stage, 'execute'), eq(caseStages.attempt, i.attempt)));
      const started = stage?.output?.goalId;
      if (typeof started === 'string') return { goalId: started, workflowId: `goal-${started}` };

      const c = ctx.caseRow;
      const goalId = randomUUID();
      const workflowId = `goal-${goalId}`;
      const text = caseGoalText({ code: c.code, label: ctx.lc.case.label, file: c.file, lc: ctx.lc, attempt: i.attempt, ...(i.reworkNote && { reworkNote: i.reworkNote }) });
      await tx.insert(goals).values({
        id: goalId,
        tenantId: i.tenantId,
        workspaceId: c.workspaceId,
        caseId: c.id,
        createdBy: c.createdBy,
        text,
        origin: isUntrusted(c.source) ? 'inbound' : 'owner',
        workflowId,
      });
      await this.audit.append(tx, i.tenantId, {
        type: 'goal.created',
        actor: ctx.coordinator ? { id: ctx.coordinator.id, kind: 'agent' } : SYSTEM,
        goalId,
        payload: { text: `${c.code} · ${c.title}`, caseId: c.id },
      });
      await tx.update(cases).set({ goalId, status: 'in_progress', updatedAt: new Date() }).where(eq(cases.id, c.id));
      await tx
        .update(caseStages)
        .set({ output: { goalId } })
        .where(and(eq(caseStages.caseId, i.caseId), eq(caseStages.stage, 'execute'), eq(caseStages.attempt, i.attempt)));
      return { goalId, workflowId };
    });
  }

  async finishExecution(i: StageWorkflowInput & { goalId: string }) {
    await this.db.tenant(i.tenantId, async (tx) => {
      const ctx = await loadCaseContext(tx, i.caseId);
      const [goal] = await tx.select().from(goals).where(eq(goals.id, i.goalId));
      if (!goal) throw new Error(`Goal ${i.goalId} not found`);
      const [report] = await this.reports.reportsFor(tx, [goal]);
      const summary =
        goal.status === 'completed'
          ? `The work is done${report?.done[0] ? `: ${report.done[0]}` : '.'}`
          : `The work ended ${goal.status.replace(/_/g, ' ')}${report?.attention[0] ? `: ${report.attention[0]}` : '.'}`;
      const execute = {
        goalId: goal.id,
        ...(goal.plan?.workflowId && { workflow: goal.plan.workflowId }),
        status: goal.status,
        summary,
        costInr: goal.costInr,
        evidence: (report?.done ?? []).slice(0, 10),
      };
      await this.save(tx, ctx, i, { part: { execute }, status: 'done', summary, actor: 'Work agents' });
    });
  }

  /** The case was cancelled while its work ran: stop the goal cleanly. */
  async cancelExecution(i: StageWorkflowInput & { goalId: string }) {
    await this.db.tenant(i.tenantId, async (tx) => {
      const [goal] = await tx
        .update(goals)
        .set({ status: 'cancelled', summary: 'Stopped: the case was cancelled.', completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(goals.id, i.goalId), inArray(goals.status, ['planning', 'awaiting_plan_approval', 'running'])))
        .returning();
      if (!goal) return;
      await tx
        .update(tasks)
        .set({ status: 'skipped', waitingOn: 'The case was cancelled' })
        .where(and(eq(tasks.goalId, i.goalId), inArray(tasks.status, ['pending', 'running', 'waiting_approval', 'waiting_on_team', 'paused'])));
      await tx
        .update(approvalRequests)
        .set({ status: 'expired' })
        .where(and(eq(approvalRequests.goalId, i.goalId), eq(approvalRequests.status, 'pending')));
      await this.audit.append(tx, i.tenantId, { type: 'goal.completed', actor: SYSTEM, goalId: i.goalId, payload: { status: 'cancelled', reason: 'The case was cancelled' } });
    });
  }

  // ---------- stage 7: verification ----------

  async verifyClose(i: StageWorkflowInput): Promise<{ verified: boolean; reason?: string }> {
    const ctx = await this.db.tenant(i.tenantId, (tx) => loadCaseContext(tx, i.caseId));
    const c = ctx.caseRow;
    const work = await this.db.tenant(i.tenantId, async (tx) => {
      if (!c.goalId) return null;
      const [goal] = await tx.select().from(goals).where(eq(goals.id, c.goalId));
      if (!goal) return null;
      const taskRows = await tx.select({ status: tasks.status }).from(tasks).where(eq(tasks.goalId, goal.id));
      const [report] = await this.reports.reportsFor(tx, [goal]);
      return { goal, escalated: taskRows.filter((t) => t.status === 'escalated').length, report: report ?? null };
    });
    const offline = offlineVerify({
      goalStatus: work?.goal.status ?? 'failed',
      escalatedTasks: work?.escalated ?? 0,
      summary: firstLine(work?.goal.summary ?? 'No work was done.'),
    });
    const asked = await this.model.ask('close', ctx, {
      file: c.file,
      now: new Date().toISOString(),
      work: { status: work?.goal.status ?? 'none', done: work?.report?.done ?? [], attention: work?.report?.attention ?? [] },
    });
    const v = mergeVerify(asked.output, offline);
    const close = { ...v, signoff: { required: false } };
    const actor = asked.output ? COORDINATOR : RULES;
    await this.db.tenant(i.tenantId, (tx) =>
      v.verified
        ? this.save(tx, ctx, i, { part: { close }, status: 'running', summary: 'Verified. Checking whether it needs a sign-off.', actor })
        : this.save(tx, ctx, i, { part: { close }, status: 'failed', summary: stageSummary('close', { ...c.file, close }, ctx.lc), actor }),
    );
    return v.verified ? { verified: true } : { verified: false, reason: v.findings[0] ?? 'The result does not match the request' };
  }

  // ---------- the end ----------

  /** Set the case's final status and outcome before its report. Idempotent. */
  async finishCase(i: { tenantId: string; caseId: string; ending: CaseEnding; reason: string | null }) {
    const notify = await this.db.tenant(i.tenantId, async (tx) => {
      const ctx = await loadCaseContext(tx, i.caseId);
      const c = ctx.caseRow;
      if (FINAL.includes(c.status) && c.closedAt) return null;
      const outcome =
        i.ending === 'closed'
          ? `Resolved${c.file.close?.findings[0] ? `: ${firstLine(c.file.close.findings[0])}` : '.'}`
          : (i.reason ?? (i.ending === 'cancelled' ? 'Cancelled.' : i.ending === 'rejected' ? 'Not approved.' : 'Needs a person to take over.'));
      await tx.update(cases).set({ status: i.ending, outcome, stage: 'report', closedAt: new Date(), updatedAt: new Date() }).where(eq(cases.id, c.id));

      // Stages cut short, or never reached, show as skipped.
      await tx
        .update(caseStages)
        .set({ status: 'skipped', completedAt: new Date(), summary: sql`coalesce(${caseStages.summary}, 'Stopped.')` })
        .where(and(eq(caseStages.caseId, c.id), inArray(caseStages.status, OPEN_STAGE)));
      const ran = new Set((await tx.select({ stage: caseStages.stage }).from(caseStages).where(eq(caseStages.caseId, c.id))).map((r) => r.stage));
      const never = STAGE_KEYS.filter((k) => k !== 'report' && !ran.has(k));
      if (never.length) {
        await tx
          .insert(caseStages)
          .values(
            never.map((k) => ({
              tenantId: i.tenantId,
              caseId: c.id,
              stage: k,
              attempt: 1,
              name: ctx.lc.stages.find((s) => s.key === k)!.name,
              status: 'skipped' as const,
              summary: 'Not needed: the case ended earlier.',
              completedAt: new Date(),
            })),
          )
          .onConflictDoNothing();
      }

      // A gate still waiting must not stay in anyone's inbox.
      const expired = await tx
        .update(approvalRequests)
        .set({ status: 'expired' })
        .where(and(eq(approvalRequests.caseId, c.id), eq(approvalRequests.status, 'pending')))
        .returning({ id: approvalRequests.id, summary: approvalRequests.summary });
      for (const a of expired) {
        await this.audit.append(tx, i.tenantId, { type: 'approval.expired', actor: SYSTEM, refId: a.id, payload: { kind: 'case_gate', summary: a.summary, caseId: c.id, reason: 'The case ended' } });
      }
      await this.audit.append(tx, i.tenantId, { type: 'case.closed', actor: SYSTEM, refId: c.id, payload: { code: c.code, status: i.ending, outcome } });
      return i.ending === 'escalated' ? `${c.code}: ${outcome}` : null;
    });
    if (notify) void this.notifications.pushToTenant(i.tenantId, { title: 'A case needs you', body: notify, data: { caseId: i.caseId } });
  }
}
