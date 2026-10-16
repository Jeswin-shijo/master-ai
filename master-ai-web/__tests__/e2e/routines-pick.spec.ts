import { expect, test } from '@playwright/test';
import { newOrganization, signInAs } from './helpers';

test('"Who does the AI call?" starts with nobody ticked each time it opens', async ({ page }) => {
  const org = await newOrganization('wholesale-retail');
  await org.api.team.add({ name: 'Ravi Kumar', phone: '+919811100011', title: 'Billing clerk' });
  await signInAs(page, org);

  await page.goto('/routines');
  const open = () => page.locator('div').filter({ hasText: "Today's bills" }).getByRole('button', { name: 'Switch it on' }).last().click();
  await open();
  const dialog = page.getByRole('dialog', { name: /Who does the AI call\?/ });
  const ravi = dialog.getByRole('checkbox', { name: /Billing clerk/ });
  await ravi.check();
  await expect(ravi).toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Switch it on' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  await open();
  const again = page.getByRole('dialog', { name: /Who does the AI call\?/ });
  await expect(again.getByRole('checkbox', { name: /Billing clerk/ })).not.toBeChecked();
  await expect(again.getByRole('button', { name: 'Switch it on' })).toBeDisabled();
});
