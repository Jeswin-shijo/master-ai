import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ORG_TYPES } from '@onehuman/schemas';
import type {
  AuthResponse,
  DeviceKey,
  HumanRole,
  LoginInput,
  RegisterDeviceKeyInput,
  RegisterPushTokenInput,
  SessionUser,
  SignupInput,
  TenantSummary,
} from '@onehuman/schemas';
import type { z } from 'zod';
import type { LoginInputSchema, SignupInputSchema } from '@onehuman/schemas';
import { AuditService } from '../audit/audit.service';
import { issueToken, type Session } from '../common/auth';
import { hashPassword, verifyPassword } from '../common/crypto';
import { DEFAULT_TENANT_SETTINGS, toTenant } from '../common/mappers';
import { DbService } from '../db/db.service';
import { deviceKeys, principals, pushTokens, tenants, users } from '../db/schema';

@Injectable()
export class IdentityService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Create a company, its owner and the owner's login in one transaction. */
  async signup(input: z.output<typeof SignupInputSchema>): Promise<AuthResponse> {
    const [existing] = await this.db.global.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existing) throw new ConflictException('That email is already registered. Sign in instead.');

    const tenantId = randomUUID();
    return this.db.tenant(tenantId, async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: input.email, name: input.ownerName, passwordHash: hashPassword(input.password) })
        .returning();
      const ready = ORG_TYPES.find((t) => t.id === input.orgType && t.sector === input.sector);
      const industry = input.industry ?? (ready ? ready.name : input.orgType);
      const [tenant] = await tx
        .insert(tenants)
        .values({ id: tenantId, name: input.companyName, industry, sector: input.sector, orgType: ready?.id ?? null, settings: DEFAULT_TENANT_SETTINGS })
        .returning();
      const [owner] = await tx
        .insert(principals)
        .values({ tenantId, kind: 'human', userId: user!.id, displayName: input.ownerName, role: 'owner' })
        .returning();
      await this.audit.append(tx, tenantId, {
        type: 'tenant.created',
        actor: { id: owner!.id, kind: 'human' },
        payload: { name: input.companyName, industry, sector: input.sector, orgType: ready?.id ?? null },
      });
      const session: Session = { userId: user!.id, principalId: owner!.id, tenantId, role: 'owner' };
      return {
        token: issueToken(session),
        user: { ...session, name: user!.name, email: user!.email, approverRoles: [] },
        tenant: toTenant(tenant!),
      };
    });
  }

  async login(input: z.output<typeof LoginInputSchema>): Promise<AuthResponse> {
    const [user] = await this.db.global.select().from(users).where(eq(users.email, input.email));
    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      throw new UnauthorizedException('Email or password is incorrect');
    }
    const memberships = await this.db.global.execute<{ tenant_id: string; principal_id: string; role: HumanRole }>(
      sql`select * from auth_user_tenants(${user.id})`,
    );
    const membership = input.tenantId
      ? memberships.rows.find((m) => m.tenant_id === input.tenantId)
      : memberships.rows[0];
    if (!membership) throw new UnauthorizedException('No active company for this login');

    const session: Session = {
      userId: user.id,
      principalId: membership.principal_id,
      tenantId: membership.tenant_id,
      role: membership.role,
    };
    const tenant = await this.tenant(session.tenantId);
    return {
      token: issueToken(session),
      user: { ...session, name: user.name, email: user.email, approverRoles: await this.approverRoles(session.tenantId, session.principalId) },
      tenant,
    };
  }

  async me(session: Session): Promise<{ user: SessionUser; tenant: TenantSummary }> {
    const [user] = await this.db.global.select().from(users).where(eq(users.id, session.userId));
    if (!user) throw new UnauthorizedException();
    return {
      user: { ...session, name: user.name, email: user.email, approverRoles: await this.approverRoles(session.tenantId, session.principalId) },
      tenant: await this.tenant(session.tenantId),
    };
  }

  /** The approver roles a person holds in a company, read fresh. */
  private async approverRoles(tenantId: string, principalId: string): Promise<string[]> {
    return this.db.tenant(tenantId, async (tx) => {
      const [p] = await tx.select({ roles: principals.approverRoles }).from(principals).where(eq(principals.id, principalId));
      return p?.roles ?? [];
    });
  }

  private async tenant(tenantId: string): Promise<TenantSummary> {
    return this.db.tenant(tenantId, async (tx) => {
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
      if (!tenant) throw new NotFoundException('Company not found');
      return toTenant(tenant);
    });
  }

  async registerDeviceKey(session: Session, input: RegisterDeviceKeyInput): Promise<DeviceKey> {
    if (Buffer.from(input.publicKey, 'base64').length !== 32) {
      throw new ConflictException('publicKey must be a 32-byte Ed25519 key in base64');
    }
    return this.db.tenant(session.tenantId, async (tx) => {
      const [key] = await tx
        .insert(deviceKeys)
        .values({ tenantId: session.tenantId, principalId: session.principalId, ...input })
        .returning();
      await this.audit.append(tx, session.tenantId, {
        type: 'device.registered',
        actor: { id: session.principalId, kind: 'human' },
        refId: key!.id,
        payload: { label: input.label, platform: input.platform },
      });
      return { id: key!.id, label: key!.label, platform: key!.platform, createdAt: key!.createdAt.toISOString() };
    });
  }

  async deviceKeys(session: Session): Promise<DeviceKey[]> {
    return this.db.tenant(session.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(deviceKeys)
        .where(and(eq(deviceKeys.principalId, session.principalId), isNull(deviceKeys.revokedAt)));
      return rows.map((k) => ({ id: k.id, label: k.label, platform: k.platform, createdAt: k.createdAt.toISOString() }));
    });
  }

  async registerPushToken(session: Session, input: RegisterPushTokenInput) {
    await this.db.tenant(session.tenantId, (tx) =>
      tx
        .insert(pushTokens)
        .values({ tenantId: session.tenantId, principalId: session.principalId, ...input })
        .onConflictDoUpdate({ target: pushTokens.token, set: { principalId: session.principalId, platform: input.platform } }),
    );
    return { ok: true as const };
  }
}
