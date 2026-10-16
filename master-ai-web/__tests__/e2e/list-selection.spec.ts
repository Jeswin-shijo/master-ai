import { expect, test } from '@playwright/test';
import { newOrganization, signInAs } from './helpers';

test('rows picked for a bulk check are dropped when the view changes', async ({ page }) => {
  const org = await newOrganization('wholesale-retail');
  await signInAs(page, org);

  await page.goto('/lists/bills');
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Not checked' }).click();
  await page.getByRole('combobox', { name: 'Date range' }).selectOption('all');
  const boxes = page.getByRole('checkbox', { name: /^Select (?!all)/ });
  await expect(boxes.nth(1)).toBeVisible();
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await expect(page.getByText('2 selected')).toBeVisible();

  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByText(/\d+ selected/)).toHaveCount(0);
});
