import { expect, test } from '@playwright/test';
import { newOrganization, signInAs } from './helpers';

/**
 * The Agents page shows each agent's job card, and the owner can add a word to
 * a safety word set the agent inherited. `sparking` is not one of the pack's
 * emergency words, so the owner can add it and take it out again.
 */
test('each agent shows its job card, and a word added to an inherited set stays after a reload until the owner takes it out', async ({ page }) => {
  const org = await newOrganization('power-plant');
  await signInAs(page, org);
  await page.goto('/agents');

  const coordinator = page.getByRole('article', { name: 'Case coordinator' });
  await expect(coordinator.getByRole('group', { name: 'Mission' }).getByRole('paragraph')).toHaveText(/^[A-Z].{20,}\.$/);
  expect(await coordinator.getByRole('list', { name: 'Never handles' }).getByRole('listitem').count()).toBeGreaterThanOrEqual(2);

  // The Case coordinator isn't customer-facing, so the customer safety sets go to the consumer desk.
  const desk = page.getByRole('article', { name: 'Consumer service desk' });
  await desk.getByRole('button', { name: 'Edit job card' }).click();
  const emergencies = desk.getByRole('group', { name: 'Emergencies' });
  await expect(emergencies.getByRole('button', { name: /Remove the word set/ })).toHaveCount(0);
  await emergencies.getByLabel('Add a word to Emergencies').fill('sparking');
  await emergencies.getByRole('button', { name: 'Add', exact: true }).click();
  await desk.getByRole('button', { name: 'Save job card' }).click();
  await expect(desk.getByRole('button', { name: 'Edit job card' })).toBeVisible();

  await page.reload();
  const saved = page.getByRole('article', { name: 'Consumer service desk' }).getByRole('group', { name: 'Emergencies' });
  await saved.getByText('Emergencies', { exact: true }).click();
  await expect(saved.getByRole('list', { name: 'Words for Emergencies' }).getByText('sparking', { exact: true })).toBeVisible();
  await expect(saved.getByText('Inherited')).toBeVisible();

  // Saved, the owner's word can still be taken out again; the pack's words can't.
  const card = page.getByRole('article', { name: 'Consumer service desk' });
  await card.getByRole('button', { name: 'Edit job card' }).click();
  const editing = card.getByRole('group', { name: 'Emergencies' });
  await expect(editing.getByRole('button', { name: 'Take out gas leak' })).toHaveCount(0);
  await editing.getByRole('button', { name: 'Take out sparking' }).click();
  await card.getByRole('button', { name: 'Save job card' }).click();
  await page.reload();
  const after = page.getByRole('article', { name: 'Consumer service desk' }).getByRole('group', { name: 'Emergencies' });
  await after.getByText('Emergencies', { exact: true }).click();
  await expect(after.getByRole('list', { name: 'Words for Emergencies' }).getByText('gas leak', { exact: true })).toBeVisible();
  await expect(after.getByRole('list', { name: 'Words for Emergencies' }).getByText('sparking', { exact: true })).toHaveCount(0);
});
