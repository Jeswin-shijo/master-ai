import { expect, test } from '@playwright/test';
import { newOrganization, sidewaysOverflow, signInAs, waitForCase } from './helpers';

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

test('an approval whose title holds a long unbroken word still fits the phone', async ({ page }) => {
  const org = await newOrganization('power-plant');
  const word = 'ChuteLinerPlateWeldingConveyorThreeBTransferHouseUnitTwoBoilerSideWork';
  const c = await org.api.cases.create({ text: `Hot work permit for ${word} tomorrow 10 am. Please arrange the permit.` });
  await waitForCase(org.api, c.id, (d) => d.approvals.some((a) => a.status === 'pending' && a.stage === 'approve'));
  await signInAs(page, org);

  for (const path of ['/approvals', `/cases/${c.id}`]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.locator('article, section[aria-label="Approval"]').first().waitFor();
    expect(await sidewaysOverflow(page), path).toBeLessThanOrEqual(0);
  }
});
