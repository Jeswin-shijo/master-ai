import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { ORG_TYPES, type AuthResponse, type CaseDetail, type TenantSummary } from '@onehuman/schemas';
import { createClient, type ApiClient } from '@onehuman/sdk';

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
export const PASSWORD = 'correct horse battery';
export const uniqueEmail = (who: string) => `${who}+${randomBytes(4).toString('hex')}@example.com`;

/** A real hot-work request from the power-plant test set (evals/suites/power-plant.yaml, contractor-welding). */
export const WELDING =
  'M/s Shree Fabricators: we will start welding of chute liner plates at Conveyor 3B transfer house tomorrow 10 am, 4 welders and 1 helper. Please arrange hot work permit.';

export interface Org {
  api: ApiClient;
  auth: AuthResponse;
  tenant: TenantSummary;
}

/** A ready organization made through the API, for tests that aren't about signing up. */
export async function newOrganization(orgType: string): Promise<Org> {
  const type = ORG_TYPES.find((t) => t.id === orgType);
  if (!type) throw new Error(`No organization type ${orgType}`);
  let token: string | null = null;
  const api = createClient({ baseUrl: API_URL, getToken: () => token });
  const auth = await api.auth.signup({
    companyName: `E2E ${type.name} ${randomBytes(2).toString('hex')}`,
    ownerName: 'Asha Owner',
    email: uniqueEmail('owner'),
    password: PASSWORD,
    sector: type.sector,
    orgType,
  });
  token = auth.token;
  const draft = await api.onboarding.preview();
  await api.onboarding.install({ draftId: draft.id, sampleData: true });
  return { api, auth, tenant: await api.tenant.get() };
}

/** Open the app already signed in, the way the web app stores its session. */
export async function signInAs(page: Page, who: { auth: AuthResponse; tenant: TenantSummary }) {
  const saved = JSON.stringify({ token: who.auth.token, user: who.auth.user, tenant: who.tenant, companies: who.auth.companies ?? [] });
  await page.addInitScript((value) => localStorage.setItem('onehuman.session', value), saved);
}

export async function waitForCase(api: ApiClient, id: string, until: (d: CaseDetail) => boolean, timeoutMs = 240_000): Promise<CaseDetail> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const d = await api.cases.get(id);
    if (until(d)) return d;
    if (Date.now() > end) throw new Error(`${d.case.code} stayed at ${d.case.stage} (${d.case.status})`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** How far the page, or the scrolling main area, can scroll sideways. 0 means it can't. */
export async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.max(...[document.documentElement, document.querySelector('main')].filter((el): el is HTMLElement => !!el).map((el) => el.scrollWidth - el.clientWidth)),
  );
}

/** Approve every agent step waiting in this person's inbox. Case approvals and sign-offs are left alone. */
export async function approveAgentSteps(page: Page) {
  await page.goto('/approvals');
  await page.getByRole('heading', { level: 1 }).waitFor();
  const steps = page.locator('article[data-kind="action"]');
  await page.getByText('Nothing needs your approval').or(page.locator('article').first()).first().waitFor();
  for (let n = await steps.count(); n > 0; n = await steps.count()) {
    await steps.first().getByRole('button', { name: 'Approve', exact: true }).click();
    await page.waitForFunction((before) => document.querySelectorAll('article[data-kind="action"]').length < before, n);
  }
}
