import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { INestApplicationContext, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ORG_TYPES } from '@onehuman/schemas';
import pg from 'pg';
import { AppModule } from '../../src/app.module';
import type { Session } from '../../src/common/auth';
import { IdentityService } from '../../src/identity/identity.service';
import { TemporalService } from '../../src/orchestration/temporal.service';
import { OnboardingService } from '../../src/tenancy/onboarding.service';

export const PASSWORD = 'correct horse battery';
export const uniqueEmail = (who: string) => `${who}+${randomBytes(4).toString('hex')}@example.com`;
/** A different client address per sign-up, so the sign-up limit never trips a spec. */
export const anyIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;

export interface Harness {
  get<T>(type: Type<T>): T;
  /** What the services asked Temporal to do. Nothing reaches a real Temporal. */
  temporal: { method: string; args: unknown[] }[];
  /** The owner's connection, for checks that look past row-level security. */
  owner: pg.Pool;
  close(): Promise<void>;
}

/**
 * The real API's modules on the test database, as the worker builds them. Temporal
 * is replaced by a recorder: specs call the workflow's activities themselves.
 */
export async function boot(): Promise<Harness> {
  const app: INestApplicationContext = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const temporal: Harness['temporal'] = [];
  const service = app.get(TemporalService) as unknown as Record<string, unknown>;
  for (const method of Object.getOwnPropertyNames(TemporalService.prototype)) {
    if (method === 'constructor' || typeof service[method] !== 'function') continue;
    service[method] = async (...args: unknown[]) => {
      temporal.push({ method, args });
      return `fake-${method}-${temporal.length}`;
    };
  }
  // vitest.integration.config.mts points DATABASE_URL at the test database's owner.
  const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  return {
    get: (type) => app.get(type),
    temporal,
    owner,
    close: async () => {
      await owner.end();
      await app.close();
    },
  };
}

export interface Org {
  session: Session;
  tenantId: string;
  workspaceId: string;
  email: string;
}

/** A signed-up organization with its ready-made pack installed (with sample records). */
export async function newOrg(h: Harness, orgType = 'power-plant'): Promise<Org> {
  const type = ORG_TYPES.find((t) => t.id === orgType);
  if (!type) throw new Error(`No organization type ${orgType}`);
  const email = uniqueEmail('owner');
  const auth = await h.get(IdentityService).signup(
    { companyName: `Spec ${type.name} ${randomBytes(2).toString('hex')}`, ownerName: 'Asha Owner', email, password: PASSWORD, sector: type.sector, orgType },
    anyIp(),
  );
  const session: Session = { userId: auth.user.userId, principalId: auth.user.principalId, tenantId: auth.tenant.id, role: 'owner' };
  const onboarding = h.get(OnboardingService);
  const draft = await onboarding.preview(session, {});
  const ws = await onboarding.install(session, draft.id, true);
  return { session, tenantId: auth.tenant.id, workspaceId: ws.id, email };
}
