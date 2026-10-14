import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  AcceptInviteInputSchema,
  CreateInviteInputSchema,
  UpdateMemberInputSchema,
  type AuthResponse,
  type CreatedInvite,
  type Invite,
  type InviteView,
  type Member,
} from '@onehuman/schemas';
import { lifecycleOf, normalizeSnapshot, roleName } from '@onehuman/agent-kit';
import { AuditService } from '../audit/audit.service';
import { CurrentSession, issueToken, ManagersOnly, Public, type Session } from '../common/auth';
import { hashPassword, verifyPassword } from '../common/crypto';
import { toTenant } from '../common/mappers';
import { RateLimiter } from '../common/rate-limit';
import { ZodPipe } from '../common/zod';
import { config } from '../config';
import { DbService, type Tx } from '../db/db.service';
import { deviceKeys, invites, principals, pushTokens, staff, tenants, users, workspaces } from '../db/schema';
import { toCompanies, type MembershipRow } from '../identity/memberships';
import {
  hashInviteToken,
  INVITE_DAYS,
  inviterStillAllowed,
  inviteStatus,
  memberChangeRefusal,
  newInviteToken,
  principalChanges,
  unknownApproverRoles,
} from './invite-rules';

type InviteRow = typeof invites.$inferSelect;

function toInvite(r: InviteRow, now = new Date()): Invite {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    approverRoles: r.approverRoles,
    status: inviteStatus(r, now),
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

/** People with a login in a company, and the invites that bring them in. */
@Injectable()
export class MembersService {
  private readonly limiter = new RateLimiter();

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string): Promise<Member[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ p: principals, email: users.email, staffId: staff.id })
        .from(principals)
        .innerJoin(users, eq(users.id, principals.userId))
        .leftJoin(staff, eq(staff.principalId, principals.id))
        .where(eq(principals.kind, 'human'))
        .orderBy(asc(principals.createdAt));
      return rows.map((r) => ({
        id: r.p.id,
        name: r.p.displayName,
        email: r.email,
        role: r.p.role as Member['role'],
        approverRoles: r.p.approverRoles,
        status: r.p.status,
        staffId: r.staffId,
        createdAt: r.p.createdAt.toISOString(),
      }));
    });
  }

  async update(session: Session, id: string, input: z.output<typeof UpdateMemberInputSchema>): Promise<Member> {
    await this.db.tenant(session.tenantId, async (tx) => {
      const target = await this.human(tx, id);
      const refused = memberChangeRefusal({ id: session.principalId, role: session.role }, { id: target.id, role: target.role }, input);
      if (refused) throw new ForbiddenException(refused);
      if (input.approverRoles) await this.checkRoles(tx, input.approverRoles);
      const changes = principalChanges(input);
      if (changes) await tx.update(principals).set(changes).where(eq(principals.id, id));
      // Someone no longer allowed to invite loses the invites they left open.
      if (input.role === 'member') await this.revokeInvitesBy(tx, session, id);
      if (input.staffId !== undefined) {
        await tx.update(staff).set({ principalId: null }).where(eq(staff.principalId, id));
        if (input.staffId) {
          const [linked] = await tx.update(staff).set({ principalId: id }).where(eq(staff.id, input.staffId)).returning();
          if (!linked) throw new NotFoundException('Team member not found');
        }
      }
      await this.audit.append(tx, session.tenantId, {
        type: 'member.updated',
        actor: { id: session.principalId, kind: 'human' },
        refId: id,
        payload: { name: target.displayName, changes: input },
      });
    });
    return (await this.list(session.tenantId)).find((m) => m.id === id)!;
  }

  /** Access ends at once: the guard reads the status on every request. */
  async remove(session: Session, id: string): Promise<Member> {
    await this.db.tenant(session.tenantId, async (tx) => {
      const target = await this.human(tx, id);
      const refused = memberChangeRefusal({ id: session.principalId, role: session.role }, { id: target.id, role: target.role }, { remove: true });
      if (refused) throw new ForbiddenException(refused);
      await tx.update(principals).set({ status: 'retired' }).where(eq(principals.id, id));
      await tx.update(deviceKeys).set({ revokedAt: new Date() }).where(and(eq(deviceKeys.principalId, id), isNull(deviceKeys.revokedAt)));
      await tx.delete(pushTokens).where(eq(pushTokens.principalId, id));
      await tx.update(staff).set({ principalId: null }).where(eq(staff.principalId, id));
      await this.revokeInvitesBy(tx, session, id);
      await this.audit.append(tx, session.tenantId, {
        type: 'member.removed',
        actor: { id: session.principalId, kind: 'human' },
        refId: id,
        payload: { name: target.displayName },
      });
    });
    return (await this.list(session.tenantId)).find((m) => m.id === id)!;
  }

  async invite(session: Session, input: z.output<typeof CreateInviteInputSchema>): Promise<CreatedInvite> {
    const made = newInviteToken();
    const row = await this.db.tenant(session.tenantId, async (tx) => {
      await this.checkRoles(tx, input.approverRoles);
      const [member] = await tx
        .select({ id: principals.id })
        .from(principals)
        .innerJoin(users, eq(users.id, principals.userId))
        .where(and(eq(users.email, input.email), eq(principals.kind, 'human'), eq(principals.status, 'active')));
      if (member) throw new ConflictException('That person is already in the company.');
      const open = (await tx.select().from(invites).where(eq(invites.email, input.email))).filter((i) => inviteStatus(i, new Date()) === 'pending');
      if (open.length) throw new ConflictException('There is already an open invite for that email. Withdraw it first to send a new one.');
      const [created] = await tx
        .insert(invites)
        .values({
          tenantId: session.tenantId,
          email: input.email,
          name: input.name,
          role: input.role,
          approverRoles: input.approverRoles,
          tokenHash: made.hash,
          expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
          createdBy: session.principalId,
        })
        .returning();
      await this.audit.append(tx, session.tenantId, {
        type: 'member.invited',
        actor: { id: session.principalId, kind: 'human' },
        refId: created!.id,
        payload: { name: input.name, email: input.email, role: input.role, approverRoles: input.approverRoles },
      });
      return created!;
    });
    const path = `/invite/${session.tenantId}/${made.token}`;
    return { ...toInvite(row), path, link: `${config.WEB_URL.replace(/\/$/, '')}${path}` };
  }

  async invites(tenantId: string): Promise<Invite[]> {
    return this.db.tenant(tenantId, async (tx) => (await tx.select().from(invites).orderBy(desc(invites.createdAt))).map((r) => toInvite(r)));
  }

  async revokeInvite(session: Session, id: string): Promise<Invite> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const [row] = await tx
        .update(invites)
        .set({ revokedAt: new Date() })
        .where(and(eq(invites.id, id), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
        .returning();
      if (!row) throw new NotFoundException('No open invite with that id');
      await this.audit.append(tx, session.tenantId, { type: 'invite.revoked', actor: { id: session.principalId, kind: 'human' }, refId: id, payload: { name: row.name } });
      return toInvite(row);
    });
  }

  /** Public: what the invite page shows. Only a pending invite is shown. */
  async view(tenantId: string, token: string, ip: string): Promise<InviteView> {
    this.limit(`invite-view:${tenantId}:${ip}`, 60);
    return this.db.tenant(tenantId, async (tx) => {
      const inv = await this.pending(tx, token);
      const [company] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
      const lc = await this.lifecycle(tx);
      const [account] = await tx.select({ id: users.id }).from(users).where(eq(users.email, inv.email));
      return {
        companyName: company!.name,
        name: inv.name,
        email: inv.email,
        role: inv.role,
        approverRoles: inv.approverRoles.map((id) => ({ id, name: roleName(lc, id) })),
        hasAccount: !!account,
        expiresAt: inv.expiresAt.toISOString(),
      };
    });
  }

  /** Public: join the company. A new person picks a password; someone with a login signs in with theirs. */
  async accept(tenantId: string, token: string, input: z.output<typeof AcceptInviteInputSchema>, ip: string): Promise<AuthResponse> {
    this.limit(`invite-accept:${tenantId}:${ip}`, 10);
    return this.db.tenant(tenantId, async (tx) => {
      const inv = await this.pending(tx, token, true);
      const [creator] = inv.createdBy
        ? await tx.select({ role: principals.role, status: principals.status }).from(principals).where(eq(principals.id, inv.createdBy))
        : [];
      if (!inviterStillAllowed(creator ?? null)) throw new NotFoundException('This invite link is not valid any more. Ask for a new one.');
      const [existing] = await tx.select().from(users).where(eq(users.email, inv.email));
      let user = existing;
      if (user) {
        if (!(await verifyPassword(input.password, user.passwordHash))) throw new UnauthorizedException('That is not the password for this email.');
      } else {
        [user] = await tx.insert(users).values({ email: inv.email, name: input.name ?? inv.name, passwordHash: await hashPassword(input.password) }).returning();
      }
      const [already] = await tx
        .select()
        .from(principals)
        .where(and(eq(principals.userId, user!.id), eq(principals.kind, 'human')));
      if (already?.status === 'active') throw new ConflictException('You are already in this company. Sign in instead.');
      const values = { displayName: input.name ?? inv.name, role: inv.role, approverRoles: inv.approverRoles, status: 'active' as const };
      const [principal] = already
        ? await tx.update(principals).set(values).where(eq(principals.id, already.id)).returning()
        : await tx.insert(principals).values({ tenantId, kind: 'human', userId: user!.id, ...values }).returning();
      await tx.update(invites).set({ acceptedAt: new Date(), acceptedBy: principal!.id }).where(eq(invites.id, inv.id));
      await this.audit.append(tx, tenantId, {
        type: 'member.joined',
        actor: { id: principal!.id, kind: 'human' },
        refId: principal!.id,
        payload: { name: principal!.displayName, role: inv.role, approverRoles: inv.approverRoles },
      });
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
      const session: Session = { userId: user!.id, principalId: principal!.id, tenantId, role: inv.role };
      const memberships = await tx.execute<MembershipRow>(sql`select * from auth_user_tenants(${user!.id})`);
      return {
        token: issueToken(session),
        user: { ...session, name: user!.name, email: user!.email, approverRoles: inv.approverRoles },
        tenant: toTenant(tenant!),
        companies: toCompanies(memberships.rows),
      };
    });
  }

  /** Withdraw the open invites a person made, when they lose the right to invite. */
  private async revokeInvitesBy(tx: Tx, session: Session, principalId: string) {
    const open = await tx
      .update(invites)
      .set({ revokedAt: new Date() })
      .where(and(eq(invites.createdBy, principalId), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
      .returning({ id: invites.id, name: invites.name });
    for (const inv of open) {
      await this.audit.append(tx, session.tenantId, {
        type: 'invite.revoked',
        actor: { id: session.principalId, kind: 'human' },
        refId: inv.id,
        payload: { name: inv.name, reason: 'The person who made it no longer has that access' },
      });
    }
  }

  private async pending(tx: Tx, token: string, lock = false): Promise<InviteRow> {
    const q = tx.select().from(invites).where(eq(invites.tokenHash, hashInviteToken(token)));
    const [inv] = lock ? await q.for('update') : await q;
    if (!inv || inviteStatus(inv, new Date()) !== 'pending') throw new NotFoundException('This invite link is not valid any more. Ask for a new one.');
    return inv;
  }

  private async human(tx: Tx, id: string) {
    const [p] = await tx.select().from(principals).where(and(eq(principals.id, id), eq(principals.kind, 'human')));
    if (!p) throw new NotFoundException('Person not found');
    return p;
  }

  private async lifecycle(tx: Tx) {
    const [ws] = await tx.select({ pack: workspaces.pack }).from(workspaces).orderBy(desc(workspaces.createdAt)).limit(1);
    if (!ws) throw new BadRequestException('Install an industry setup first.');
    return lifecycleOf(normalizeSnapshot(ws.pack));
  }

  private async checkRoles(tx: Tx, roles: string[]) {
    if (roles.length === 0) return;
    const unknown = unknownApproverRoles(roles, await this.lifecycle(tx));
    if (unknown.length) throw new BadRequestException(`Not an approval role in this organization: ${unknown.join(', ')}`);
  }

  private limit(bucket: string, perMinute: number) {
    if (!this.limiter.take(bucket, perMinute, 60_000)) throw new HttpException('Too many requests. Try again in a minute.', HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Controller()
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get('members')
  list(@CurrentSession() s: Session) {
    return this.members.list(s.tenantId);
  }

  @ManagersOnly()
  @Get('members/invites')
  invites(@CurrentSession() s: Session) {
    return this.members.invites(s.tenantId);
  }

  @ManagersOnly()
  @Post('members/invites')
  invite(@CurrentSession() s: Session, @Body(new ZodPipe(CreateInviteInputSchema)) body: z.output<typeof CreateInviteInputSchema>) {
    return this.members.invite(s, body);
  }

  @ManagersOnly()
  @Post('members/invites/:id/revoke')
  revoke(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.revokeInvite(s, id);
  }

  @ManagersOnly()
  @Patch('members/:id')
  update(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateMemberInputSchema)) body: z.output<typeof UpdateMemberInputSchema>) {
    return this.members.update(s, id, body);
  }

  @ManagersOnly()
  @Post('members/:id/remove')
  remove(@CurrentSession() s: Session, @Param('id', ParseUUIDPipe) id: string) {
    return this.members.remove(s, id);
  }

  @Public()
  @Get('invites/:tenantId/:token')
  view(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('token') token: string, @Req() req: Request) {
    return this.members.view(tenantId, token, req.ip ?? 'unknown');
  }

  @Public()
  @Post('invites/:tenantId/:token/accept')
  accept(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('token') token: string,
    @Body(new ZodPipe(AcceptInviteInputSchema)) body: z.output<typeof AcceptInviteInputSchema>,
    @Req() req: Request,
  ) {
    return this.members.accept(tenantId, token, body, req.ip ?? 'unknown');
  }
}
