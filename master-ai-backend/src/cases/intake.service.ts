import { randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  CreateIntakeKeyInputSchema,
  IntakeCaseInputSchema,
  PublicFormInputSchema,
  type CreatedIntakeKey,
  type IntakeKey,
  type PublicForm,
} from '@onehuman/schemas';
import { lifecycleOf, normalizeSnapshot } from '@onehuman/agent-kit';
import { AuditService, SYSTEM } from '../audit/audit.service';
import { CurrentSession, Public, requireManager, type Session } from '../common/auth';
import { sha256 } from '../common/crypto';
import { RateLimiter } from '../common/rate-limit';
import { ZodPipe } from '../common/zod';
import { DbService, type Tx } from '../db/db.service';
import { intakeKeys, tenants, workspaces } from '../db/schema';
import { RecordsService } from '../records/records.service';
import { CasesService } from './cases.service';

type KeyRow = typeof intakeKeys.$inferSelect;

export function hashIntakeKey(key: string): string {
  return sha256(`onehuman:intake:${key}`);
}

/** A new key, its hash (stored) and a hint (first characters, shown in Settings). */
export function newIntakeKey(): { key: string; hash: string; hint: string } {
  const key = `ohk_${randomBytes(24).toString('base64url')}`;
  return { key, hash: hashIntakeKey(key), hint: key.slice(0, 8) };
}

export function bearerKey(header: string | undefined): string | null {
  const m = header?.match(/^bearer\s+(\S+)$/i);
  return m ? m[1]! : null;
}

const MINUTE = 60_000;
const LIMITS = { formPerIp: 10, formPerKey: 60, apiPerKey: 120 };

function toKey(k: KeyRow): IntakeKey {
  return {
    id: k.id,
    kind: k.kind,
    source: k.source,
    label: k.label,
    hint: k.hint,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
  };
}

/** Requests from outside: the public form and systems or partners with a key. */
@Injectable()
export class IntakeService {
  private readonly limiter = new RateLimiter();

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly records: RecordsService,
    private readonly cases: CasesService,
  ) {}

  async listKeys(session: Session): Promise<IntakeKey[]> {
    requireManager(session);
    return this.db.tenant(session.tenantId, async (tx) => (await tx.select().from(intakeKeys).orderBy(desc(intakeKeys.createdAt))).map(toKey));
  }

  async createKey(session: Session, input: z.output<typeof CreateIntakeKeyInputSchema>): Promise<CreatedIntakeKey> {
    requireManager(session);
    const made = newIntakeKey();
    return this.db.tenant(session.tenantId, async (tx) => {
      const ws = await this.records.activeWorkspace(tx);
      const source = input.kind === 'form' ? 'customer' : input.source!;
      const [row] = await tx
        .insert(intakeKeys)
        .values({ tenantId: session.tenantId, workspaceId: ws.id, kind: input.kind, source, label: input.label, keyHash: made.hash, hint: made.hint, createdBy: session.principalId })
        .returning();
      await this.audit.append(tx, session.tenantId, {
        type: 'intake_key.created',
        actor: { id: session.principalId, kind: 'human' },
        refId: row!.id,
        payload: { kind: input.kind, source, label: input.label, hint: made.hint },
      });
      return { ...toKey(row!), key: made.key, formPath: input.kind === 'form' ? `/r/${session.tenantId}/${made.key}` : null };
    });
  }

  async revokeKey(session: Session, id: string): Promise<IntakeKey> {
    requireManager(session);
    return this.db.tenant(session.tenantId, async (tx) => {
      const [row] = await tx.update(intakeKeys).set({ revokedAt: new Date() }).where(and(eq(intakeKeys.id, id), isNull(intakeKeys.revokedAt))).returning();
      if (!row) throw new NotFoundException('Key not found or already revoked');
      await this.audit.append(tx, session.tenantId, { type: 'intake_key.revoked', actor: { id: session.principalId, kind: 'human' }, refId: id, payload: { label: row.label } });
      return toKey(row);
    });
  }

  /** Public: the form's heading. */
  async form(tenantId: string, key: string, ip: string): Promise<PublicForm> {
    this.limit(`form-ip:${ip}`, LIMITS.formPerIp * 3);
    return this.db.tenant(tenantId, async (tx) => {
      const k = await this.findKey(tx, key, 'form');
      if (!k) throw new NotFoundException('This request form link is not active.');
      const [row] = await tx
        .select({ name: tenants.name, pack: workspaces.pack })
        .from(tenants)
        .innerJoin(workspaces, eq(workspaces.id, k.workspaceId))
        .where(eq(tenants.id, tenantId));
      return { companyName: row!.name, caseLabel: lifecycleOf(normalizeSnapshot(row!.pack)).case.label };
    });
  }

  /** Public: a customer's request through the form. Opened as untrusted. */
  async submitForm(tenantId: string, key: string, input: z.output<typeof PublicFormInputSchema>, ip: string): Promise<{ code: string }> {
    this.limit(`form-ip:${ip}`, LIMITS.formPerIp);
    const k = await this.db.tenant(tenantId, (tx) => this.findKey(tx, key, 'form'));
    if (!k) throw new NotFoundException('This request form link is not active.');
    this.limit(`form-key:${k.id}`, LIMITS.formPerKey);
    const { row } = await this.cases.open(tenantId, {
      workspaceId: k.workspaceId,
      source: 'customer',
      requester: { name: input.name, ...(input.phone && { phone: input.phone }), ...(input.email && { email: input.email }) },
      text: input.text,
      createdBy: null,
      actor: SYSTEM,
    });
    await this.touch(tenantId, k.id);
    return { code: row.code };
  }

  /** Public: a system or partner posts a request with its key. A repeated externalRef returns the same case. */
  async submit(tenantId: string, authorization: string | undefined, input: z.output<typeof IntakeCaseInputSchema>, ip: string) {
    const key = bearerKey(authorization);
    if (!key) throw new UnauthorizedException('Send the intake key as "Authorization: Bearer <key>".');
    this.limit(`api-ip:${ip}`, LIMITS.apiPerKey * 2);
    const k = await this.db.tenant(tenantId, (tx) => this.findKey(tx, key, 'api'));
    if (!k) throw new UnauthorizedException('Unknown or revoked intake key.');
    this.limit(`api-key:${k.id}`, LIMITS.apiPerKey);
    const { row, duplicate } = await this.cases.open(tenantId, {
      workspaceId: k.workspaceId,
      source: k.source,
      requester: { name: input.requester.name, ...(input.requester.phone && { phone: input.requester.phone }), ...(input.requester.email && { email: input.requester.email }) },
      text: input.text,
      ...(input.title && { title: input.title }),
      ...(input.amountInr !== undefined && { amountInr: input.amountInr }),
      ...(input.externalRef && { externalRef: input.externalRef }),
      createdBy: null,
      actor: SYSTEM,
    });
    await this.touch(tenantId, k.id);
    return { caseId: row.id, code: row.code, duplicate };
  }

  private async findKey(tx: Tx, key: string, kind: 'form' | 'api'): Promise<KeyRow | null> {
    const [k] = await tx
      .select()
      .from(intakeKeys)
      .where(and(eq(intakeKeys.keyHash, hashIntakeKey(key)), eq(intakeKeys.kind, kind), isNull(intakeKeys.revokedAt)));
    return k ?? null;
  }

  private async touch(tenantId: string, keyId: string) {
    await this.db.tenant(tenantId, (tx) => tx.update(intakeKeys).set({ lastUsedAt: new Date() }).where(eq(intakeKeys.id, keyId)));
  }

  private limit(bucket: string, perMinute: number) {
    if (!this.limiter.take(bucket, perMinute, MINUTE)) throw new HttpException('Too many requests. Try again in a minute.', HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Controller()
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Get('intake-keys')
  list(@CurrentSession() s: Session) {
    return this.intake.listKeys(s);
  }

  @Post('intake-keys')
  create(@CurrentSession() s: Session, @Body(new ZodPipe(CreateIntakeKeyInputSchema)) body: z.output<typeof CreateIntakeKeyInputSchema>) {
    return this.intake.createKey(s, body);
  }

  @Post('intake-keys/:id/revoke')
  revoke(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.intake.revokeKey(s, id);
  }

  @Public()
  @Get('intake/:tenantId/forms/:key')
  form(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('key') key: string, @Req() req: Request) {
    return this.intake.form(tenantId, key, req.ip ?? 'unknown');
  }

  @Public()
  @Post('intake/:tenantId/forms/:key')
  submitForm(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('key') key: string,
    @Body(new ZodPipe(PublicFormInputSchema)) body: z.output<typeof PublicFormInputSchema>,
    @Req() req: Request,
  ) {
    return this.intake.submitForm(tenantId, key, body, req.ip ?? 'unknown');
  }

  @Public()
  @Post('intake/:tenantId/cases')
  submit(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body(new ZodPipe(IntakeCaseInputSchema)) body: z.output<typeof IntakeCaseInputSchema>,
    @Req() req: Request,
  ) {
    return this.intake.submit(tenantId, authorization, body, req.ip ?? 'unknown');
  }
}
