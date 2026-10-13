import { expect, test } from '@playwright/test';
import { newOrganization, sidewaysOverflow, signInAs, waitForCase, WELDING } from './helpers';

test('long request text wraps and stays text', async ({ page }) => {
  const org = await newOrganization('travel-agency');
  const text = [
    '<b>Bold?</b> <script>window.__pwned = true</script>',
    'x'.repeat(300),
    'The group of 42 students from St. Mary’s needs the Munnar deposit refunded. '.repeat(60),
  ]
    .join(' ')
    .slice(0, 4000);
  const c = await org.api.cases.create({ text });
  await signInAs(page, org);

  await page.goto(`/cases/${c.id}`);
  await page.getByText('Their own words').click({ timeout: 60_000 });
  await expect(page.getByTestId('request-text')).toContainText('<script>window.__pwned = true</script>');
  expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined();
  await expect(page.locator('main script')).toHaveCount(0);
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

  await page.goto(`/cases?q=${encodeURIComponent(c.code)}`);
  await expect(page.getByRole('link', { name: new RegExp(c.code) })).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
});

test('reduced motion stops the live stage, and the halo becomes a static ring', async ({ page }) => {
  const org = await newOrganization('power-plant');
  const c = await org.api.cases.create({ text: WELDING });
  await waitForCase(org.api, c.id, (d) => d.approvals.some((a) => a.status === 'pending' && a.stage === 'approve'));
  await signInAs(page, org);

  const halo = page.getByTestId('case-canvas').locator('[data-stage="approve"] .live-halo');
  const animation = () => halo.evaluate((el) => getComputedStyle(el).animationName);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`/cases/${c.id}`);
  await expect.poll(animation).toBe('oh-halo');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(animation).toBe('none');
  expect(Number(await halo.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0);
  const ping = page.getByTestId('case-canvas').locator('[data-person] .pulse-dot');
  expect(await ping.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});

test('a customer raises a request through the public form, and it arrives as a case', async ({ page, browser }) => {
  const org = await newOrganization('municipal');
  await signInAs(page, org);
  await page.goto('/settings');
  await page.locator('#key-label').fill('Website');
  await page.getByRole('button', { name: 'Make a form link' }).click();
  const link = await page.getByLabel('Form link').inputValue();

  const customerContext = await browser.newContext();
  const form = await customerContext.newPage();
  await form.goto(new URL(link).pathname);
  await form.getByLabel('Your name').fill('Ramesh');
  await form.getByLabel('Phone').fill('9846001122');
  await form.getByLabel('What do you need?').fill('Street light pole 14 in Sector 4 is sparking after the rain');
  await form.getByRole('button', { name: /^Send / }).click();
  const code = (await form.getByText(/^[A-Z]{2,4}-\d{4}$/).textContent())!.trim();
  await customerContext.close();

  await page.goto(`/cases?q=${encodeURIComponent(code)}`);
  await expect(page.getByRole('link', { name: new RegExp(code) })).toBeVisible();
});
