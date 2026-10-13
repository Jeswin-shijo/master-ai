import type { HumanRole } from '@onehuman/schemas';
import { forInbox } from '../approvals/may-decide';

/** How many pending decisions are this person's: the pulse says "needs you" only for those. */
export function needsYouCount(person: { role: HumanRole; approverRoles: string[] }, pendingApprovers: string[]): number {
  return forInbox(
    person,
    pendingApprovers.map((approver) => ({ approver })),
  ).length;
}
