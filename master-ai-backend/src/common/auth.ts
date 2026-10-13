import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import type { HumanRole } from '@onehuman/schemas';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { principals } from '../db/schema';
import { checkAccess } from './access';
import { signJwt, verifyJwt } from './crypto';

export interface Session {
  userId: string;
  principalId: string;
  tenantId: string;
  role: HumanRole;
}

const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export function issueToken(session: Session): string {
  return signJwt({ sub: session.principalId, uid: session.userId, tid: session.tenantId, role: session.role }, config.JWT_SECRET, SESSION_TTL_SECONDS);
}

export function readToken(token: string): Session | null {
  const p = verifyJwt<{ sub: string; uid: string; tid: string; role: HumanRole }>(token, config.JWT_SECRET);
  if (!p?.sub || !p.tid || !p.uid) return null;
  return { principalId: p.sub, userId: p.uid, tenantId: p.tid, role: p.role };
}

const IS_PUBLIC = 'onehuman:public';
/** Mark a route as reachable without a session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

const MANAGERS_ONLY = 'onehuman:managers-only';
/** Owner and admins only: settings, the pack, rules, intake keys, the team and the kill switch. */
export const ManagersOnly = () => SetMetadata(MANAGERS_ONLY, true);

/**
 * Global guard: every route needs a valid session unless marked @Public().
 * The principal is read on every request, so a removed person is turned away
 * and a role change applies at once.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<Request & { session?: Session }>();
    const header = req.headers.authorization;
    // EventSource cannot send headers, so SSE streams pass the token as a query param.
    const token = header?.startsWith('Bearer ')
      ? header.slice(7)
      : req.method === 'GET' && typeof req.query.token === 'string'
        ? req.query.token
        : undefined;
    const session = token ? readToken(token) : null;
    if (!session) throw new UnauthorizedException('Sign in required');
    const [principal] = await this.db.tenant(session.tenantId, (tx) =>
      tx.select({ role: principals.role, status: principals.status }).from(principals).where(eq(principals.id, session.principalId)),
    );
    const access = checkAccess(principal ?? null, !!this.reflector.getAllAndOverride<boolean>(MANAGERS_ONLY, targets));
    if (!access.ok) throw access.status === 401 ? new UnauthorizedException(access.message) : new ForbiddenException(access.message);
    req.session = { ...session, role: access.role };
    return true;
  }
}

/** Settings, intake keys and cancelling cases are for the owner and admins. */
export function requireManager(session: Session): void {
  if (session.role !== 'owner' && session.role !== 'admin') throw new ForbiddenException('Only the owner or an admin can do this.');
}

export const CurrentSession = createParamDecorator((_: unknown, ctx: ExecutionContext): Session => {
  const req = ctx.switchToHttp().getRequest<{ session?: Session }>();
  if (!req.session) throw new UnauthorizedException();
  return req.session;
});
