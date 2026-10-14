import { expect, test } from '@playwright/test';
import { lightPalette } from '@onehuman/ui';
import { newOrganization, signInAs } from './helpers';

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

test('the light theme puts the same app on the light background', async ({ page }) => {
  const org = await newOrganization('it-services');
  await signInAs(page, org);
  await page.addInitScript(() => localStorage.setItem('onehuman.theme', 'light'));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(rgb(lightPalette.background));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
