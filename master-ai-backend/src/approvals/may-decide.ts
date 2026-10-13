import type { ApprovalKind, HumanRole } from '@onehuman/schemas';

/**
 * Who may decide an approval routed to `approver` (a lifecycle role id such
 * as safety-officer, or "owner"):
 * - the owner may decide anything;
 * - an admin may decide anything routed to the owner, plus their own roles;
 * - a member may decide only approvals for roles they hold.
 * The roles are read from the database at decision time, so a change takes
 * effect without signing in again.
 */
export function mayDecide(person: { role: HumanRole; approverRoles: string[] }, approver: string): boolean {
  if (person.role === 'owner') return true;
  if (approver === person.role) return true;
  if (approver === 'owner') return person.role === 'admin';
  return person.approverRoles.includes(approver);
}

/**
 * Where a gate goes: to the rule's role when an active person holds it,
 * otherwise to the owner, with a note saying why.
 */
export function routeApprover(role: string, holders: number, roleLabel: string): { approver: string; note: string | null } {
  if (role === 'owner' || holders > 0) return { approver: role, note: null };
  return { approver: 'owner', note: `Nobody holds the ${roleLabel} role yet, so it came to the owner.` };
}

/**
 * Batch approval ("Approve N low-risk") is for agent actions only. A case step
 * (an approval or sign-off) is decided on its own, after reading it.
 */
export function batchRefusal(kind: ApprovalKind): string | null {
  return kind === 'case_gate' ? 'A case step is approved on its own, after reading it, not in a batch.' : null;
}

/** The "mine" inbox: only approvals this person may decide. */
export function forInbox<T extends { approver: string }>(person: { role: HumanRole; approverRoles: string[] }, approvals: T[]): T[] {
  return approvals.filter((a) => mayDecide(person, a.approver));
}
