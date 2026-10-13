import type { Company, HumanRole } from '@onehuman/schemas';

/** One row of auth_user_tenants(user): a company this login belongs to. */
export type MembershipRow = {
  tenant_id: string;
  tenant_name: string;
  principal_id: string;
  role: string;
};

export function toCompanies(rows: MembershipRow[]): Company[] {
  return rows.map((r) => ({ id: r.tenant_id, name: r.tenant_name, role: r.role as HumanRole }));
}

/** The company to open: the one asked for (only if they belong to it), or their first. */
export function pickMembership(rows: MembershipRow[], tenantId?: string): MembershipRow | null {
  if (tenantId) return rows.find((r) => r.tenant_id === tenantId) ?? null;
  return rows[0] ?? null;
}
