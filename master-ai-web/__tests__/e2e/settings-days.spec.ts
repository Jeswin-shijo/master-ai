import { expect, test } from '@playwright/test';
import { newOrganization, signInAs } from './helpers';

test('three quick taps on the outside-call days all stick', async ({ page }) => {
  const org = await newOrganization('wholesale-retail');
  await signInAs(page, org);
  await page.goto('/settings');
  const days = page.getByRole('group', { name: 'Days for outside calls' });
  await expect(days.getByRole('button', { name: 'Sun', exact: true })).toBeVisible();
  const before = await days.getByRole('button', { pressed: true }).allTextContents();
  const off = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].filter((d) => !before.includes(d)).slice(0, 3);
  const on = before.slice(0, 3);
  // Tap three different days with no wait between them.
  const taps = off.length === 3 ? off : on;
  for (const d of taps) await days.getByRole('button', { name: d, exact: true }).click();
  const flipped = off.length === 3 ? [...before, ...taps] : before.filter((d) => !taps.includes(d));
  await expect(days.getByRole('button', { pressed: true })).toHaveCount(flipped.length);
  await page.reload();
  await expect(page.getByRole('group', { name: 'Days for outside calls' }).getByRole('button', { name: 'Sun', exact: true })).toBeVisible();
  const after = await page.getByRole('group', { name: 'Days for outside calls' }).getByRole('button', { pressed: true }).allTextContents();
  expect(after.sort()).toEqual([...flipped].sort());
});
