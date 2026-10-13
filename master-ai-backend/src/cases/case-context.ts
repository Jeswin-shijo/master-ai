import { and, eq } from 'drizzle-orm';
import type { CaseFile, CaseSource, CaseStatus, ResolvedPack } from '@onehuman/schemas';
import { CASE_COORDINATOR_ROLE, lifecycleOf, normalizeSnapshot } from '@onehuman/agent-kit';
import { DEFAULT_TENANT_SETTINGS } from '../common/mappers';
import type { Tx } from '../db/db.service';
import { agents, cases, tenants, workspaces } from '../db/schema';

export const OPEN_CASE_STATUSES: readonly CaseStatus[] = ['open', 'needs_info', 'waiting_approval', 'in_progress', 'waiting_signoff'];

/** Why this workspace can't run cases yet, or null when it can. */
export function caseReadiness(pack: ResolvedPack): string | null {
  if (pack.lifecycle && pack.agents.some((a) => a.role === CASE_COORDINATOR_ROLE)) return null;
  return 'This workspace was set up before requests ran as cases. Add the platform update on the Industry pack page, then try again.';
}

/**
 * While a kill switch is on, people in the app are refused (they can resume
 * it). Requests from outside (form, systems, partners) are kept: the case waits
 * at its first stage until resume, so nothing is lost and no agent acts.
 */
export function pauseRefusal(source: CaseSource, paused: { tenant: boolean; workspace: boolean }): string | null {
  if (source !== 'owner' && source !== 'staff') return null;
  if (paused.tenant) return 'The company-wide kill switch is on. Resume to take new requests.';
  if (paused.workspace) return 'This workspace is paused.';
  return null;
}

/** The request words with more details added at the end. */
export function appendInfo(file: CaseFile, from: string, text: string, at: Date): CaseFile {
  const r = file.request!;
  const day = at.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
  return { ...file, request: { ...r, text: `${r.text}\n\nMore details from ${from} (${day}): ${text}` } };
}

/** Everything a stage needs about one case, loaded under RLS. */
export async function loadCaseContext(tx: Tx, caseId: string) {
  const [row] = await tx
    .select({ caseRow: cases, workspace: workspaces, tenant: tenants })
    .from(cases)
    .innerJoin(workspaces, eq(workspaces.id, cases.workspaceId))
    .innerJoin(tenants, eq(tenants.id, cases.tenantId))
    .where(eq(cases.id, caseId));
  if (!row) throw new Error(`Case ${caseId} not found`);
  const pack = normalizeSnapshot(row.workspace.pack);
  const [coordinator] = await tx
    .select()
    .from(agents)
    .where(and(eq(agents.workspaceId, row.workspace.id), eq(agents.role, CASE_COORDINATOR_ROLE)));
  const settings = { ...DEFAULT_TENANT_SETTINGS, ...row.tenant.settings, calls: { ...DEFAULT_TENANT_SETTINGS.calls, ...row.tenant.settings.calls } };
  return { ...row, tenant: { ...row.tenant, settings }, pack, lc: lifecycleOf(pack), coordinator: coordinator ?? null };
}

export type CaseContext = Awaited<ReturnType<typeof loadCaseContext>>;
