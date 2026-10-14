import { expect, test, type Page } from '@playwright/test';
import { NAV } from '../src/lib/nav';
import { API_URL, newOrganization, PASSWORD, signInAs, uniqueEmail, waitForCase, WELDING, type Org } from './helpers';
import { createClient } from '@onehuman/sdk';

/**
 * Every page in the menu opens cleanly: a heading, its own tab title, no page
 * errors, and none of what owners must never see (ids, tool names). The Audit
 * page is where raw data is meant to be, so it is spared the leak check.
 */

const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const TOOL =
  /\b(?:records\.(?:search|get|create|update)|knowledge\.search|message\.(?:draft|send)|payment\.request|refund\.issue|schedule\.create|document\.generate|staff\.delegate|human\.handoff|case\.(?:proceed|close)|task\.finish)\b/;
const RAW_DATA_PAGES = new Set(['/audit']);

let org: Org;
let member: Org;

test.beforeAll(async () => {
  org = await newOrganization('power-plant');
  // Something in every list: a job waiting at its permit.
  const c = await org.api.cases.create({ text: WELDING });
  await waitForCase(org.api, c.id, (d) => d.approvals.some((a) => a.status === 'pending'));
  // A member of the same company.
  const made = await org.api.invites.create({ name: 'Manoj Member', email: uniqueEmail('manoj'), role: 'member' });
  let token: string | null = null;
  const api = createClient({ baseUrl: API_URL, getToken: () => token });
  const auth = await api.invites.accept(org.tenant.id, made.path.split('/').pop()!, { password: PASSWORD });
  token = auth.token;
  member = { api, auth, tenant: await api.tenant.get() };
});

async function opensCleanly(page: Page, path: string, label: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page).toHaveTitle(`${label} · ONEHUMAN OS`);
  // Let the page's own requests settle before reading it.
  await page.waitForLoadState('networkidle');
  if (!RAW_DATA_PAGES.has(path)) {
    const text = await page.getByRole('main').innerText();
    expect(text.length, `${label} has no text to check`).toBeGreaterThan(40);
    expect(text, `${label} shows an id`).not.toMatch(ID);
    expect(text, `${label} names a tool`).not.toMatch(TOOL);
  }
  expect(errors, `${label} threw`).toEqual([]);
}

test.describe('as the owner', () => {
  for (const item of NAV) {
    test(`${item.label} opens cleanly`, async ({ page }) => {
      await signInAs(page, org);
      await opensCleanly(page, item.to, item.label);
    });
  }
});

test.describe('as a member', () => {
  for (const item of NAV.filter((i) => !i.managersOnly)) {
    test(`${item.label} opens cleanly`, async ({ page }) => {
      await signInAs(page, member);
      await opensCleanly(page, item.to, item.label);
    });
  }
});
