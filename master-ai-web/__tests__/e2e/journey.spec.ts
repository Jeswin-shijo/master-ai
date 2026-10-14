import { expect, test } from '@playwright/test';
import { approveAgentSteps, PASSWORD, uniqueEmail, WELDING } from './helpers';

test('a power plant signs up, and a hot-work job runs all 8 stages with the safety officer deciding in their own browser', async ({ page, browser }) => {
  test.setTimeout(600_000);

  await test.step('sign up by sector and type', async () => {
    await page.goto('/signup');
    await page.getByRole('radio', { name: /Energy & Heavy Industry/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radio', { name: 'Power plant & utilities' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Organization name').fill('Kochi Thermal E2E');
    await page.getByLabel('Your name').fill('Asha Owner');
    await page.getByLabel('Email').fill(uniqueEmail('owner'));
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create my organization' }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  await test.step('the install preview names the 8 stages for a power plant', async () => {
    const stages = page.getByRole('list', { name: 'The 8 stages of every job' });
    await expect(stages.getByRole('listitem')).toHaveCount(8, { timeout: 60_000 });
    await expect(stages).toContainText('Permit & clearance');
    await page.getByRole('button', { name: 'Install and open Home' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Good to see you');
  });

  await test.step('simulated staff answer the calls', async () => {
    await page.goto('/settings');
    const auto = page.getByRole('radio', { name: /A simulated staff member/ });
    await auto.click(); // the radio turns on once the setting is saved
    await expect(auto).toBeChecked();
  });

  let inviteLink = '';
  await test.step('invite the safety officer', async () => {
    await page.goto('/team');
    await page.getByRole('button', { name: 'Invite a person' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Sunita Safety');
    await page.getByLabel('Email').fill(uniqueEmail('sunita'));
    await page.getByRole('checkbox', { name: /Safety officer/ }).check();
    await page.getByRole('button', { name: 'Create invite link' }).click();
    inviteLink = await page.getByLabel('Invite link').inputValue();
    expect(inviteLink).toContain('/invite/');
  });

  const officerContext = await browser.newContext();
  const sunita = await officerContext.newPage();
  await test.step('the safety officer joins from the link, in their own browser', async () => {
    await sunita.goto(new URL(inviteLink).pathname);
    await sunita.getByLabel('Choose a password').fill(PASSWORD);
    await sunita.getByRole('button', { name: /^Join / }).click();
    await expect(sunita.getByRole('heading', { level: 1 })).toContainText('Good to see you, Sunita');
  });

  let caseUrl = '';
  await test.step('the owner raises a hot-work request', async () => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New request' }).first().click();
    await page.getByLabel("What's needed?").fill(WELDING);
    await page.getByRole('button', { name: 'Raise job' }).click();
    await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
    caseUrl = new URL(page.url()).pathname;
  });

  const canvas = page.getByTestId('case-canvas');
  await test.step('the stages run on their own up to the permit, which waits for the safety officer', async () => {
    await expect(canvas.locator('[data-stage="approve"]')).toHaveAttribute('data-stage-state', 'waiting', { timeout: 240_000 });
    for (const stage of ['request', 'review', 'classify', 'assign']) {
      await expect(canvas.locator(`[data-stage="${stage}"]`)).toHaveAttribute('data-stage-state', /done|skipped/);
    }
    await expect(canvas.locator('[data-person]')).toContainText('Safety officer');
    await expect(page.getByRole('region', { name: 'Approval' })).toBeVisible();
  });

  await test.step('the safety officer opens it from their inbox and approves it inline', async () => {
    await sunita.goto('/approvals');
    const gate = sunita.locator('article[data-kind="case_gate"]').first();
    await gate.getByRole('link', { name: 'Open the case' }).click();
    await sunita.getByLabel('Note for the record').fill('Permit HW-118 issued, area checked');
    await sunita.getByRole('region', { name: 'Approval' }).getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(sunita.getByRole('region', { name: 'Approval' })).toHaveCount(0);
  });

  await test.step('the work runs (the owner approves any agent step) until the sign-off waits', async () => {
    await expect
      .poll(
        async () => {
          await approveAgentSteps(page);
          await page.goto(caseUrl);
          return canvas.locator('[data-stage="close"]').getAttribute('data-stage-state');
        },
        { timeout: 360_000, intervals: [5_000] },
      )
      .toBe('waiting');
  });

  await test.step('the safety officer signs off, and the job closes with its report', async () => {
    await sunita.goto(caseUrl);
    await sunita.getByRole('region', { name: 'Sign-off' }).getByRole('button', { name: 'Sign off' }).click();
    await expect(canvas.locator('[data-stage="report"]')).toHaveAttribute('data-stage-state', 'done', { timeout: 240_000 });
    await expect(page.getByRole('article', { name: /^Report for JOB-/ })).toBeVisible();
    await expect(page.getByText('Signed off by Sunita Safety.')).toBeVisible();
  });

  await test.step('Reports lists the job and opens its full report: every stage, who decided, Print / PDF', async () => {
    await page.goto('/reports');
    const requests = page.getByRole('region', { name: 'Requests' });
    await expect(requests).toContainText('JOB-');
    await requests.getByRole('link', { name: 'Open report' }).first().click();
    const report = page.getByRole('article', { name: 'Job report' });
    await expect(report.getByRole('heading', { level: 1 })).toContainText('JOB-');
    for (const stage of ['Job raised', "Engineer's first check", 'Permit & clearance', 'Work under permit', 'Permit return & sign-off', 'Monthly review & lessons']) {
      await expect(report).toContainText(stage);
    }
    await expect(report).toContainText('Approval: approved by Sunita Safety');
    await expect(report).toContainText('Sign-off: approved by Sunita Safety');
    await expect(page.getByRole('button', { name: 'Print / PDF' })).toBeVisible();
    // The stage-6 goal text is written for the agents; people never see it.
    await expect(page.getByRole('main')).not.toContainText(/Do what this \w+ needs|playbooks for this kind of work/);
  });

  await test.step("the work's step-by-step page names the job, not the agents' instructions", async () => {
    await page.goto(caseUrl);
    await page.getByRole('link', { name: 'See the work step by step' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('JOB-');
    await expect(page.getByRole('link', { name: /^Back to JOB-/ })).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText(/Do what this \w+ needs|playbooks for this kind of work/);
  });

  await officerContext.close();
});
