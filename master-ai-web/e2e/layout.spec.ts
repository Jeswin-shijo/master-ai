import { expect, test } from '@playwright/test';
import { newOrganization, sidewaysOverflow, signInAs } from './helpers';

test('no sideways scroll at phone width, and the main buttons are big enough to tap', async ({ page }) => {
  const org = await newOrganization('hospital');
  const c = await org.api.cases.create({ text: `Patient in bed 12 needs the discharge summary approved before 5 pm today. ${'y'.repeat(300)}` });
  await signInAs(page, org);

  for (const path of ['/', '/cases', `/cases/${c.id}`, '/approvals']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await sidewaysOverflow(page), path).toBeLessThanOrEqual(0);
  }

  await page.goto('/');
  for (const button of await page.getByRole('button', { name: 'New request' }).all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});
