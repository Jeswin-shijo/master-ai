import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { HumanRole } from '@onehuman/schemas';
import { config } from '../config';
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

/** Global guard: every route needs a valid session unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
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
    req.session = session;
    return true;
  }
}

export const CurrentSession = createParamDecorator((_: unknown, ctx: ExecutionContext): Session => {
  const req = ctx.switchToHttp().getRequest<{ session?: Session }>();
  if (!req.session) throw new UnauthorizedException();
  return req.session;
});
