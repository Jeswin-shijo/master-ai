import type { HumanRole, LifecycleRole, Member } from '@onehuman/schemas';

/** Each approval role and who holds it now. With nobody, its approvals go to the owner. */
export function roleHolders(roles: LifecycleRole[], members: Member[]): { role: LifecycleRole; holders: string[] }[] {
  return roles
    .filter((r) => r.id !== 'owner')
    .map((role) => ({ role, holders: members.filter((m) => m.status === 'active' && m.approverRoles.includes(role.id)).map((m) => m.name) }));
}

interface Me {
  role: HumanRole;
  principalId: string;
}

/** The owner and admins change people; nobody changes the owner here. The server checks again. */
export function canEditMember(me: Me, m: Member): boolean {
  return me.role !== 'member' && m.role !== 'owner' && m.status !== 'retired';
}

export function canRemoveMember(me: Me, m: Member): boolean {
  return canEditMember(me, m) && m.id !== me.principalId;
}
