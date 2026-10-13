import type { HumanRole } from '@onehuman/schemas';

export type AccessDecision = { ok: true; role: HumanRole } | { ok: false; status: 401 | 403; message: string };

/**
 * What a signed-in person may do right now, from their principal row: a
 * removed person is turned away, and the access role comes from the database,
 * so a change takes effect without signing in again.
 */
export function checkAccess(principal: { role: string; status: string } | null, managersOnly: boolean): AccessDecision {
  if (!principal || principal.status !== 'active') {
    return { ok: false, status: 401, message: 'Your access to this company has ended. Ask the owner for a new invite.' };
  }
  const role = principal.role as HumanRole;
  if (managersOnly && role !== 'owner' && role !== 'admin') {
    return { ok: false, status: 403, message: 'Only the owner or an admin can do this.' };
  }
  return { ok: true, role };
}
