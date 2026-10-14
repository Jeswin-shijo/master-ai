import { expect, test } from '@playwright/test';
import { PASSWORD, uniqueEmail, WELDING } from './helpers';

/**
 * The main path in every engine people use: Chromium (Chrome, Edge), Firefox
 * and WebKit (Safari on iPhone and Mac). Run against the production build
 * (CI), it also runs under the hosting headers, so a blocked script or
 * connection fails it.
 */
test('sign up, raise a request, watch it live, and read, copy and print its report', async ({ page, browserName }) => {
  test.setTimeout(300_000);
  const problems: string[] = [];
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content.Security.Policy|Refused to/i.test(msg.text())) problems.push(msg.text());
  });

  await test.step('sign up', async () => {
    await page.goto('/signup');
    await expect(page).toHaveTitle('Create your organization · ONEHUMAN OS');
    await page.getByRole('radio', { name: /Energy & Heavy Industry/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radio', { name: 'Power plant & utilities' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Organization name').fill(`${browserName} Thermal`);
    await page.getByLabel('Your name').fill('Asha Owner');
    await page.getByLabel('Email').fill(uniqueEmail(browserName));
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create my organization' }).click();
    await expect(page.getByRole('list', { name: 'The 8 stages of every job' }).getByRole('listitem')).toHaveCount(8, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Install and open Home' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Good to see you');
    await expect(page).toHaveTitle('Home · ONEHUMAN OS');
  });

  let caseUrl = '';
  await test.step('raise a request; the canvas fills in live, without reloading', async () => {
    await page.getByRole('button', { name: 'New request' }).first().click();
    await page.getByLabel("What's needed?").fill(WELDING);
    await page.getByRole('button', { name: 'Raise job' }).click();
    await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
    caseUrl = new URL(page.url()).pathname;
    const canvas = page.getByTestId('case-canvas');
    await expect(canvas.locator('[data-stage="request"]')).toHaveAttribute('data-stage-state', 'done', { timeout: 120_000 });
    await expect(canvas.locator('[data-stage="approve"]')).toHaveAttribute('data-stage-state', 'waiting', { timeout: 240_000 });
    await expect(page).toHaveTitle(/^JOB-\d+ · .+ · ONEHUMAN OS$/);
  });

  await test.step('open the report, copy it, and print it clean', async () => {
    await page.getByRole('link', { name: /^Report( so far)?$/ }).click();
    const report = page.getByRole('article', { name: 'Job report' });
    await expect(report.getByRole('heading', { level: 1 })).toContainText('JOB-');
    await expect(report).toContainText('Permit & clearance');
    // The title is the PDF's file name when it is printed.
    await expect(page).toHaveTitle(/^JOB-\d+ · .+ · Job report · ONEHUMAN OS$/);
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('button', { name: 'Print / PDF' })).toBeHidden();
    await expect(report).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
    await expect(page.getByRole('link', { name: /^Back to JOB-/ })).toHaveAttribute('href', caseUrl);
  });

  // Moving between screens never set off the "couldn't start" note.
  await expect(page.getByRole('heading', { name: "This page couldn't start in this browser" })).toBeHidden();
  expect(problems).toEqual([]);
});
