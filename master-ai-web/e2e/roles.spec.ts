import { expect, test } from '@playwright/test';
import { createClient } from '@onehuman/sdk';
import { API_URL, newOrganization, PASSWORD, signInAs, uniqueEmail } from './helpers';

test('a member sees the work pages only, keeps New request, and has no kill switch or team controls', async ({ page }) => {
  const org = await newOrganization('power-plant');
  const invite = await org.api.invites.create({ name: 'Manoj Member', email: uniqueEmail('manoj') });
  const auth = await createClient({ baseUrl: API_URL }).invites.accept(org.tenant.id, invite.path.split('/').pop()!, { password: PASSWORD });
  await signInAs(page, { auth, tenant: auth.tenant });

  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Home', 'Cases', 'Approvals', 'Team', 'Routines', 'Calls', 'Reports', 'Knowledge']);
  await expect(page.getByRole('button', { name: /all agents/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New request' }).first()).toBeVisible();

  await page.goto('/team');
  await expect(page.getByRole('heading', { name: 'People with a login' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite a person' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change' })).toHaveCount(0);
});
