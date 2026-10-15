import { expect, test } from '@playwright/test';
import { newOrganization, signInAs } from './helpers';

test('bills added by hand count for the person even when the dialog is closed without Done, and the next person starts fresh', async ({ page }) => {
  const org = await newOrganization('wholesale-retail');
  const ravi = await org.api.team.add({ name: 'Ravi Kumar', phone: '+919811100001', title: 'Billing clerk' });
  const meena = await org.api.team.add({ name: 'Meena Iyer', phone: '+919811100002', title: 'Billing clerk' });
  const routine = await org.api.routines.create({ templateId: 'todays-bills', staffIds: [ravi.id, meena.id] });
  await signInAs(page, org);

  await page.goto(`/routines/${routine.id}`);
  await page.getByRole('article').filter({ hasText: 'Ravi Kumar' }).getByRole('button', { name: 'Fill in' }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: "Add today's bills" });
  await dialog.getByLabel('Bill no.').fill('HAND-1');
  await dialog.getByLabel('Type', { exact: false }).selectOption({ index: 1 });
  await dialog.getByLabel('Party').selectOption({ index: 1 });
  await dialog.getByLabel('Total').fill('1180');
  await dialog.getByRole('button', { name: 'Add bill' }).click();
  await expect(dialog.getByText('1 added so far.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  await expect
    .poll(async () => {
      const day = await org.api.routines.day(routine.id);
      const entry = day.entries.find((e) => e.staffId === ravi.id)!;
      return [entry.status, entry.values.items];
    })
    .toEqual(['reported', 1]);
  const bills = await org.api.lists.page('bills', { range: 'all' });
  expect(JSON.stringify(bills.items)).toContain('HAND-1');

  await page.getByRole('article').filter({ hasText: 'Meena Iyer' }).getByRole('button', { name: 'Fill in' }).click();
  const second = page.getByRole('dialog').filter({ hasText: "Add today's bills" });
  await expect(second.getByText('Each one goes to Bills.')).toBeVisible();
  await expect(second.getByText(/added so far/)).toHaveCount(0);
});
