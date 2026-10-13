interface Person {
  id: string;
  role: string;
  status: string;
  approverRoles: string[];
}

/**
 * Who should get a push: for an approval routed to a role, its holders and
 * the owner; for "owner" or company news, the owner and admins. Removed people
 * get nothing.
 */
export function pushAudience(people: Person[], target: { role: string } | 'managers'): string[] {
  const active = people.filter((p) => p.status === 'active');
  if (target === 'managers' || target.role === 'owner') return active.filter((p) => p.role === 'owner' || p.role === 'admin').map((p) => p.id);
  return active.filter((p) => p.role === 'owner' || p.approverRoles.includes(target.role)).map((p) => p.id);
}
