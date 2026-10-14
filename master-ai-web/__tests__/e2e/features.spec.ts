import { expect, test } from '@playwright/test';
import { newOrganization, signInAs, WELDING } from './helpers';

/** The features no other browser test touches: the kill switch, Knowledge, Team with routines. */

test('the kill switch pauses every agent and the owner’s new requests, until it is resumed', async ({ page }) => {
  const org = await newOrganization('power-plant');
  await signInAs(page, org);
  await page.goto('/');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Pause all agents' }).click();
  await expect(page.getByText('The kill switch is on.')).toBeVisible();

  await page.getByRole('button', { name: 'New request' }).first().click();
  await page.getByLabel("What's needed?").fill(WELDING);
  await page.getByRole('button', { name: 'Raise job' }).click();
  await expect(page.getByText('The company-wide kill switch is on. Resume to take new requests.')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Resume all agents' }).click();
  await expect(page.getByText('The kill switch is on.')).toBeHidden();
  expect((await org.api.tenant.get()).status).toBe('active');
});

test('a document added to Knowledge is listed with its searchable chunks, and stays after a reload', async ({ page }) => {
  const org = await newOrganization('travel-agency');
  await signInAs(page, org);
  await page.goto('/knowledge');
  await page.getByLabel('Title').fill('Cancellation policy');
  await page.getByLabel('Content').fill('Full refund up to 30 days before departure. 50% up to 15 days. No refund after that, except for medical emergencies with a certificate.');
  await page.getByRole('button', { name: 'Add to knowledge base' }).click();
  const doc = page.getByRole('listitem').filter({ hasText: 'Cancellation policy' });
  await expect(doc).toContainText(/\d+ chunks?/);
  await expect(page.getByLabel('Title')).toHaveValue('');
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: 'Cancellation policy' })).toBeVisible();
});

test('a person added on Team is phoned by an automatic check-in, and their answers fill the board', async ({ page }) => {
  test.setTimeout(240_000);
  const org = await newOrganization('power-plant');
  await org.api.tenant.updateSettings({ calls: { simulatorMode: 'auto', fastSchedule: true } });
  await signInAs(page, org);

  await page.goto('/team');
  await page.getByRole('button', { name: 'Add person' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Ramesh Kumar');
  await page.getByLabel('Phone').fill('+91 98470 55555');
  await page.getByLabel('Job title').fill('Shift supervisor');
  await page.getByRole('button', { name: 'Add to team' }).click();
  await expect(page.getByText('Ramesh Kumar')).toBeVisible();

  await page.goto('/routines');
  // Switching a check-in on opens its board.
  await page.getByRole('button', { name: 'Switch it on' }).first().click();
  await expect(page).toHaveURL(/\/routines\/[0-9a-f-]{36}$/);

  // Ramesh reports to it: pick him if he isn't already.
  const ramesh = page.getByRole('button', { name: 'Ramesh Kumar' });
  if ((await ramesh.getAttribute('aria-pressed')) !== 'true') await ramesh.click();
  await expect(ramesh).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /Call everyone now|Chase missing now/ }).click();
  // Every person in charge (the sample team and Ramesh) answers the AI's call.
  await expect(page.getByText('Everyone', { exact: true })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText('Not reported yet')).toHaveCount(0);
});
