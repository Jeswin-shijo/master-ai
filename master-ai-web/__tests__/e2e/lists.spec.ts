import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { newOrganization, signInAs } from './helpers';

/** India's date, which "This month" uses. */
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

test('the head finds a bill that does not add up, accepts it with a note, corrects it and downloads the list', async ({ page }) => {
  const org = await newOrganization('wholesale-retail');
  const party = (await org.api.lists.page('parties', { range: 'all' })).items[0]!;
  await org.api.lists.create('bills', {
    billNo: 'E2E-1', billType: 'sales invoice', party: party.id, billDate: istToday(),
    taxableValue: 40840, gstAmount: 7360, total: 48260, paymentStatus: 'unpaid',
  });
  await signInAs(page, org);

  await page.goto('/lists');
  await page.getByRole('link', { name: /^Bills/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bills' })).toBeVisible();
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Has problems' }).click();
  await page.getByLabel('Search this list').fill('E2E-1');
  await page.getByRole('row', { name: /E2E-1/ }).click();

  const panel = page.getByRole('dialog');
  await expect(panel.getByText("Total ₹48,260 doesn't equal Taxable value + GST amount (₹48,200)")).toBeVisible();
  await panel.getByRole('button', { name: 'Mark as checked' }).click();
  await panel.getByLabel('Why is it right as it is?').fill("Rounded on the party's request");
  await panel.getByRole('button', { name: 'Mark as checked' }).click();
  await expect(panel.getByText(/Checked by Asha Owner/)).toBeVisible();
  await expect(panel.getByText(/\(seen\)$/)).toBeVisible();

  await panel.getByRole('button', { name: 'Edit' }).click();
  await panel.getByLabel('Taxable value').fill('40900');
  await panel.getByRole('button', { name: 'Save changes' }).click();
  await expect(panel.getByText(/doesn't equal/)).toHaveCount(0);
  await expect(panel.getByText('Taxable value: ₹40,840 → ₹40,900')).toBeVisible();
  await panel.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByText(/^Total ₹/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const csv = readFileSync((await (await download).path())!, 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('E2E-1');
});
