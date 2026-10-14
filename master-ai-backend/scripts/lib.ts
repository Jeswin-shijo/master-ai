/**
 * Helpers shared by the end-to-end scripts (smoke.ts, sectors.mts): they talk
 * to a running API exactly the way the apps do.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { CaseDetail, SectorId } from '@onehuman/schemas';
import { ApiError, createClient, createDeviceKey, signApproval, type ApiClient } from '@onehuman/sdk';

export const API_URL = process.env.API_URL ?? 'http://localhost:3000';
export const PASSWORD = 'correct horse battery';

export function log(step: string, detail = '') {
  console.log(`✓ ${step}${detail ? `  ${detail}` : ''}`);
}

export async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 60_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function onboard(sector: SectorId, orgType: string, industry: string | undefined, companyName: string) {
  let token: string | null = null;
  const api = createClient({ baseUrl: API_URL, getToken: () => token });
  const email = `owner+${randomBytes(4).toString('hex')}@example.com`;
  const auth = await api.auth.signup({ companyName, ownerName: 'Asha Owner', email, password: PASSWORD, sector, orgType, industry });
  token = auth.token;
  const draft = await api.onboarding.preview();
  const ws = await api.onboarding.install({ draftId: draft.id, sampleData: true });
  return { api, auth, draft, ws, email };
}

export async function signedDecision(api: ApiClient, seed: string, keyId: string, approvalId: string, decision: 'approved' | 'rejected', notes?: string) {
  const signedAt = new Date().toISOString();
  const signature = signApproval(seed, { approvalId, decision, editedArgs: null, notes: notes ?? null, signedAt });
  return api.approvals.decide(approvalId, { decision, notes, signature, keyId, signedAt });
}

export interface SuiteCase {
  id: string;
  request: string;
  amount_inr?: number;
  expect: { category: string; priority: string; review: string; approval?: { required: boolean; role?: string }; signoff?: { required: boolean; role?: string } };
}

/** A real request from an organization type's test set. */
export function suiteCase(orgType: string, id: string): SuiteCase {
  const suite = parse(readFileSync(join(__dirname, '../../evals/suites', `${orgType}.yaml`), 'utf8')) as { cases: SuiteCase[] };
  const found = suite.cases.find((c) => c.id === id);
  if (!found) throw new Error(`No case ${id} in the ${orgType} test set`);
  return found;
}

export const FINAL = ['closed', 'rejected', 'cancelled', 'escalated'];

/** Wait for a case to reach a state, approving gates and actions on the way when asked. */
export async function driveCase(
  api: ApiClient,
  seed: string,
  keyId: string,
  caseId: string,
  until: (d: CaseDetail) => boolean,
  opts: { approve?: boolean; timeoutMs?: number } = {},
): Promise<CaseDetail> {
  return waitFor(
    `case ${caseId}`,
    async () => {
      const d = await api.cases.get(caseId);
      if (until(d)) return d;
      if (opts.approve) {
        const pending = (await api.approvals.list()).filter((a) => a.caseId === caseId || (d.case.goalId && a.goalId === d.case.goalId));
        for (const a of pending) await signedDecision(api, seed, keyId, a.id, 'approved', 'Checked by the smoke test');
      }
      return null;
    },
    opts.timeoutMs ?? 240_000,
  );
}

export async function expectStatus(promise: Promise<unknown>, status: number, what: string) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ApiError && err.status === status) return log(what, `${err.status} ${err.message}`);
    throw err;
  }
  throw new Error(`${what}: expected ${status}, got success`);
}


export type Person = Awaited<ReturnType<typeof invite>>;

/** Invite someone with an access role and approver roles; they accept, sign in and register a device key. */
export async function invite(
  owner: ApiClient,
  tenantId: string,
  who: { name: string; approverRoles?: string[]; role?: 'admin' | 'member'; email?: string; password?: string },
) {
  const email = who.email ?? `${who.name.toLowerCase().replace(/[^a-z]+/g, '')}+${randomBytes(3).toString('hex')}@example.com`;
  const inv = await owner.invites.create({ name: who.name, email, approverRoles: who.approverRoles ?? [], role: who.role ?? 'member' });
  const token = inv.path.split('/').pop()!;
  const view = await owner.invites.view(tenantId, token);
  const auth = await owner.invites.accept(tenantId, token, { password: who.password ?? PASSWORD });
  let session: string | null = auth.token;
  const api = createClient({ baseUrl: API_URL, getToken: () => session });
  const key = createDeviceKey(new Uint8Array(randomBytes(32)));
  const device = await api.auth.registerDeviceKey({ publicKey: key.publicKey, label: `e2e-${who.name}`, platform: 'web' });
  return { api, auth, key, device, inv, view, signOut: () => (session = null) };
}
