import { randomBytes } from 'node:crypto';
import type { HumanRole, InviteStatus, ResolvedLifecycle } from '@onehuman/schemas';
import { sha256 } from '../common/crypto';

export const INVITE_DAYS = 7;

export function hashInviteToken(token: string): string {
  return sha256(`onehuman:invite:${token}`);
}

export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInviteToken(token) };
}

export function inviteStatus(row: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now: Date): InviteStatus {
  if (row.acceptedAt) return 'accepted';
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

/** Approver roles the organization's lifecycle does not define. "owner" is an access role, never granted this way. */
export function unknownApproverRoles(roles: string[], lc: ResolvedLifecycle): string[] {
  const known = new Set(lc.roles.map((r) => r.id).filter((id) => id !== 'owner'));
  return roles.filter((r) => !known.has(r));
}

/**
 * Why `actor` may not make this change to `target`, or null. The owner's
 * access is fixed, and nobody changes their own access or approval powers.
 */
export function memberChangeRefusal(
  actor: { id: string; role: HumanRole },
  target: { id: string; role: string },
  change: { role?: string; approverRoles?: string[]; staffId?: string | null; remove?: boolean },
): string | null {
  if (target.role === 'owner') return "The owner's access can't be changed or removed.";
  const touchesAccess = change.role !== undefined || change.approverRoles !== undefined || change.remove;
  if (target.id === actor.id && touchesAccess) return "You can't change your own access or approval roles. Ask the owner.";
  return null;
}

/** The principal fields an update sets, or null when it only touches the staff link. */
export function principalChanges(input: { role?: 'admin' | 'member'; approverRoles?: string[]; staffId?: string | null }): { role?: 'admin' | 'member'; approverRoles?: string[] } | null {
  const set = { ...(input.role !== undefined && { role: input.role }), ...(input.approverRoles !== undefined && { approverRoles: input.approverRoles }) };
  return Object.keys(set).length ? set : null;
}

/** An invite stands only while the person who made it is still an active owner or admin. */
export function inviterStillAllowed(creator: { role: string; status: string } | null): boolean {
  return !!creator && creator.status === 'active' && (creator.role === 'owner' || creator.role === 'admin');
}
