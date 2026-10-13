import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  CancelCaseInputSchema,
  CaseInfoInputSchema,
  CreateCaseInputSchema,
  type Case,
  type CaseDetail,
  type CaseSource,
  type RequestPart,
  type Requester,
} from '@onehuman/schemas';
import { formatCaseCode, lifecycleOf, normalizeSnapshot, offlineRequest } from '@onehuman/agent-kit';
import { AuditService, type Actor } from '../audit/audit.service';
import { CurrentSession, requireManager, type Session } from '../common/auth';
import { toApproval, toCase, toCaseStage } from '../common/mappers';
import { ZodPipe } from '../common/zod';
import { DbService, type Tx } from '../db/db.service';
import { isUniqueViolation } from '../db/errors';
import { agents, approvalRequests, cases, caseStages, tenants, users, workspaceCounters, workspaces } from '../db/schema';
import { caseWorkflowId } from '../orchestration/shared';
import { TemporalService } from '../orchestration/temporal.service';
import { RecordsService } from '../records/records.service';
import { ReportsService } from '../reports/reports.service';
import { appendInfo, caseReadiness, OPEN_CASE_STATUSES } from './case-context';

type CaseRow = typeof cases.$inferSelect;

export interface OpenCaseInput {
  workspaceId?: string;
  source: CaseSource;
  requester: Requester;
  text: string;
  title?: string;
  amountInr?: number;
  presetCategory?: string;
  externalRef?: string;
  createdBy: string | null;
  actor: Actor;
}

/** Next number in the workspace's sequence. One upsert, so two requests never share a number. */
export async function nextCaseNumber(tx: Tx, tenantId: string, workspaceId: string): Promise<number> {
  const [row] = await tx
    .insert(workspaceCounters)
    .values({ tenantId, workspaceId, kind: 'case', value: 1 })
    .onConflictDoUpdate({ target: [workspaceCounters.workspaceId, workspaceCounters.kind], set: { value: sql`${workspaceCounters.value} + 1` } })
    .returning({ value: workspaceCounters.value });
  return row!.value;
}

const ACTIVE_STAGE_STATES = ['running', 'needs_info', 'waiting_approval'] as const;

/** Cases: every request runs the 8 stages as a durable workflow. */
@Injectable()
export class CasesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly temporal: TemporalService,
    private readonly records: RecordsService,
    private readonly reports: ReportsService,
  ) {}

  /** "New request" from someone with a login. */
  async create(session: Session, input: z.output<typeof CreateCaseInputSchema>): Promise<Case> {
    const [user] = await this.db.global.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, session.userId));
    const requester: Requester = input.requester
      ? { name: input.requester.name, ...(input.requester.phone && { phone: input.requester.phone }), ...(input.requester.email && { email: input.requester.email }) }
      : { name: user?.name ?? 'Owner', ...(user?.email && { email: user.email }) };
    const { row } = await this.open(session.tenantId, {
      workspaceId: input.workspaceId,
      source: session.role === 'owner' ? 'owner' : 'staff',
      requester,
      text: input.text,
      title: input.title,
      amountInr: input.amountInr,
      presetCategory: input.category,
      createdBy: session.principalId,
      actor: { id: session.principalId, kind: 'human' },
    });
    return toCase(row);
  }

  /** Every way in (app, form, intake API, routines) comes through here. */
  async open(tenantId: string, input: OpenCaseInput): Promise<{ row: CaseRow; duplicate: boolean }> {
    let result: { row: CaseRow; duplicate: boolean };
    try {
      result = await this.db.tenant(tenantId, (tx) => this.insert(tx, tenantId, input));
    } catch (err) {
      if (!input.externalRef || !isUniqueViolation(err, 'cases_external_ref_idx')) throw err;
      // Two posts with the same ref at the same moment: the other one won. Answer with its case.
      const [row] = await this.db.tenant(tenantId, (tx) => tx.select().from(cases).where(eq(cases.externalRef, input.externalRef!)));
      if (!row) throw err;
      result = { row, duplicate: true };
    }
    // Starting is idempotent, so a repeat also starts a case whose first start failed.
    if (result.row.status === 'open' && result.row.stage === 'request') await this.temporal.startCase({ tenantId, caseId: result.row.id });
    return result;
  }

  private async insert(tx: Tx, tenantId: string, input: OpenCaseInput): Promise<{ row: CaseRow; duplicate: boolean }> {
    if (input.externalRef) {
      const [existing] = await tx.select().from(cases).where(eq(cases.externalRef, input.externalRef));
      if (existing) return { row: existing, duplicate: true };
    }
    const [tenant] = await tx.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
    if (tenant?.status === 'paused') throw new ConflictException('The company-wide kill switch is on. Resume to take new requests.');
    const ws = await this.records.activeWorkspace(tx, input.workspaceId);
    if (ws.status === 'paused') throw new ConflictException('This workspace is paused.');
    const pack = normalizeSnapshot(ws.pack);
    const notReady = caseReadiness(pack);
    if (notReady) throw new ConflictException(notReady);
    const lc = lifecycleOf(pack);

    const id = randomUUID();
    const number = await nextCaseNumber(tx, tenantId, ws.id);
    const code = formatCaseCode(lc.case.prefix, number);
    const request: RequestPart = {
      ...offlineRequest({ text: input.text, title: input.title, requester: input.requester, source: input.source, receivedAt: new Date().toISOString() }),
      ...(input.amountInr !== undefined && { amountInr: input.amountInr }),
      ...(input.presetCategory && { presetCategory: input.presetCategory }),
    };
    const [row] = await tx
      .insert(cases)
      .values({
        id,
        tenantId,
        workspaceId: ws.id,
        number,
        code,
        title: request.title,
        source: input.source,
        requester: input.requester,
        externalRef: input.externalRef ?? null,
        file: { request },
        workflowId: caseWorkflowId(id),
        createdBy: input.createdBy,
      })
      .returning();
    await this.audit.append(tx, tenantId, {
      type: 'case.created',
      actor: input.actor,
      refId: id,
      payload: { code, title: request.title, label: lc.case.label, source: input.source },
    });
    return { row: row!, duplicate: false };
  }

  async list(tenantId: string, status: 'open' | 'all'): Promise<Case[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(cases)
        .where(status === 'open' ? inArray(cases.status, [...OPEN_CASE_STATUSES]) : undefined)
        .orderBy(desc(cases.createdAt))
        .limit(200);
      return rows.map(toCase);
    });
  }

  async detail(tenantId: string, id: string): Promise<CaseDetail> {
    return this.db.tenant(tenantId, async (tx) => {
      const [row] = await tx.select().from(cases).where(eq(cases.id, id));
      if (!row) throw new NotFoundException('Case not found');
      const stageRows = await tx.select().from(caseStages).where(eq(caseStages.caseId, id)).orderBy(asc(caseStages.createdAt));
      const approvalRows = await tx
        .select({ approval: approvalRequests, agentName: agents.name })
        .from(approvalRequests)
        .innerJoin(agents, eq(agents.id, approvalRequests.agentId))
        .where(eq(approvalRequests.caseId, id))
        .orderBy(asc(approvalRequests.createdAt));
      const [ws] = await tx.select({ pack: workspaces.pack }).from(workspaces).where(eq(workspaces.id, row.workspaceId));
      return {
        case: toCase(row),
        label: lifecycleOf(normalizeSnapshot(ws!.pack)).case,
        file: row.file,
        stages: stageRows.map(toCaseStage),
        approvals: approvalRows.map((r) => toApproval(r.approval, r.agentName)),
        report: await this.reports.forCase(tx, row),
      };
    });
  }

  /** The details review asked for. Review runs again if the case is waiting for them. */
  async addInfo(session: Session, id: string, input: z.output<typeof CaseInfoInputSchema>): Promise<Case> {
    const { row, stageWorkflowId } = await this.db.tenant(session.tenantId, async (tx) => {
      const [current] = await tx.select().from(cases).where(eq(cases.id, id)).for('update');
      if (!current) throw new NotFoundException('Case not found');
      if (!OPEN_CASE_STATUSES.includes(current.status)) throw new ConflictException(`This case is already ${current.status}.`);
      const [user] = await tx.select({ name: users.name }).from(users).where(eq(users.id, session.userId));
      const file = appendInfo(current.file, user?.name ?? 'the owner', input.text, new Date());
      const [updated] = await tx.update(cases).set({ file, updatedAt: new Date() }).where(eq(cases.id, id)).returning();
      await this.audit.append(tx, session.tenantId, {
        type: 'case.info_added',
        actor: { id: session.principalId, kind: 'human' },
        refId: id,
        payload: { code: current.code, text: input.text },
      });
      const [waiting] = await tx
        .select({ workflowId: caseStages.workflowId })
        .from(caseStages)
        .where(and(eq(caseStages.caseId, id), eq(caseStages.stage, 'review'), eq(caseStages.status, 'needs_info')))
        .orderBy(desc(caseStages.attempt))
        .limit(1);
      return { row: updated!, stageWorkflowId: waiting?.workflowId ?? null };
    });
    if (stageWorkflowId) await this.temporal.addCaseInfo(stageWorkflowId);
    return toCase(row);
  }

  /** Owner or admin: stop the case. It still ends with its report. */
  async cancel(session: Session, id: string, input: z.output<typeof CancelCaseInputSchema>): Promise<Case> {
    requireManager(session);
    const { row, stageWorkflowId } = await this.db.tenant(session.tenantId, async (tx) => {
      const [current] = await tx.select().from(cases).where(eq(cases.id, id)).for('update');
      if (!current) throw new NotFoundException('Case not found');
      if (!OPEN_CASE_STATUSES.includes(current.status)) throw new ConflictException(`This case is already ${current.status}.`);
      await this.audit.append(tx, session.tenantId, {
        type: 'case.cancelled',
        actor: { id: session.principalId, kind: 'human' },
        refId: id,
        payload: { code: current.code, reason: input.reason ?? null },
      });
      const [active] = await tx
        .select({ workflowId: caseStages.workflowId })
        .from(caseStages)
        .where(and(eq(caseStages.caseId, id), inArray(caseStages.status, [...ACTIVE_STAGE_STATES])))
        .orderBy(desc(caseStages.createdAt))
        .limit(1);
      return { row: current, stageWorkflowId: active?.workflowId ?? null };
    });
    await this.temporal.cancelCase(id, stageWorkflowId, input.reason);
    return toCase(row);
  }
}

@Controller('cases')
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Post()
  create(@CurrentSession() s: Session, @Body(new ZodPipe(CreateCaseInputSchema)) body: z.output<typeof CreateCaseInputSchema>) {
    return this.cases.create(s, body);
  }

  @Get()
  list(@CurrentSession() s: Session, @Query('status') status = 'open') {
    if (status !== 'open' && status !== 'all') throw new BadRequestException('status must be open or all');
    return this.cases.list(s.tenantId, status);
  }

  @Get(':id')
  detail(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.cases.detail(s.tenantId, id);
  }

  @Post(':id/info')
  addInfo(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(CaseInfoInputSchema)) body: z.output<typeof CaseInfoInputSchema>) {
    return this.cases.addInfo(s, id, body);
  }

  @Post(':id/cancel')
  cancel(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(CancelCaseInputSchema)) body: z.output<typeof CancelCaseInputSchema>) {
    return this.cases.cancel(s, id, body);
  }
}
