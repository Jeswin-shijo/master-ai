import { expect, test, type Locator } from '@playwright/test';
import { newOrganization, signInAs } from './helpers';

/** India's date `n` days from today. */
const istDay = (n: number) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

/** Says each reply in the simulator and waits for the AI line that should follow it. */
async function talk(call: Locator, turns: [reply: string, expectAfter: string][]) {
  for (const [reply, next] of turns) {
    await call.getByLabel('Your reply').fill(reply);
    await call.getByRole('button', { name: 'Send' }).click();
    await expect(call).toContainText(next, { timeout: 20_000 });
  }
}

test('a clerk reads out a bill on a simulated call and it lands on the Bills list', async ({ page }) => {
  test.setTimeout(120_000);
  const org = await newOrganization('wholesale-retail');
  const ravi = await org.api.team.add({ name: 'Ravi Kumar', phone: '+91 98470 61234', title: 'Billing clerk' });
  const routine = await org.api.routines.create({ templateId: 'todays-bills', staffIds: [ravi.id] });
  await signInAs(page, org);
  await page.goto(`/routines/${routine.id}`);
  await expect(page.getByText(/adds the day's bills to Bills/)).toBeVisible();
  await org.api.routines.run(routine.id);

  const ring = page.getByRole('dialog', { name: 'Incoming call' });
  await expect(ring).toContainText('Collecting items', { timeout: 30_000 });
  await ring.getByRole('button', { name: 'Answer' }).click();
  const call = page.getByRole('dialog', { name: 'Call with Ravi Kumar' });
  await expect(call).toContainText("calling for today's bills");
  await talk(call, [
    ['One', '1, got it.'],
    ['E2E-C1', "What's the type:"],
    ['sales invoice', 'Which party?'],
    ['Nobody Known', "I'll note Nobody Known as you said it."],
    ['48,260', "What's the GST amount?"],
    ['7,360', "What's the due date?"],
    ['skip', 'Is that right?'],
    ['yes', 'Any more bills?'],
    ["No, that's all", "I've added 1 bill"],
  ]);

  await page.goto('/lists');
  await page.getByRole('link', { name: /^Bills/ }).click();
  await page.getByLabel('Search this list').fill('E2E-C1');
  await page.getByRole('row', { name: /E2E-C1/ }).click();
  const panel = page.getByRole('dialog', { name: 'E2E-C1' });
  await expect(panel).toContainText('Came in: Call with Ravi Kumar');
  await expect(panel).toContainText('Not checked');
});

test('the owner switches on a follow-up, a party says it is paid on a simulated call, and the head applies it', async ({ page }) => {
  test.setTimeout(120_000);
  const org = await newOrganization('wholesale-retail');
  await org.api.lists.removeSamples();
  const party = await org.api.lists.create('parties', { name: 'E2E Party Traders', partyType: 'retailer', phone: '+91 98470 71234' });
  await org.api.lists.create('bills', { billNo: 'E2E-F1', billType: 'sales invoice', party: party.id, billDate: istDay(-10), dueDate: istDay(-3), total: 1000, paymentStatus: 'unpaid' });
  await signInAs(page, org);

  await page.goto('/lists/bills');
  const toggle = page.getByRole('switch', { name: 'Unpaid bills → the party' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(/switched on by Asha Owner/)).toBeVisible();
  await page.getByRole('button', { name: 'Call now' }).click();

  const ring = page.getByRole('dialog', { name: 'Incoming call' });
  await expect(ring).toContainText('AI is calling E2E Party Traders', { timeout: 30_000 });
  await expect(ring).toContainText('A customer or supplier');
  await ring.getByRole('button', { name: 'Answer' }).click();
  const call = page.getByRole('dialog', { name: 'Call with E2E Party Traders' });
  await expect(call).toContainText('Am I speaking with someone from E2E Party Traders?');
  await expect(call).not.toContainText('E2E-F1: ');
  await talk(call, [
    ['Yes, speaking', 'Could you tell me when it will be paid?'],
    ["It's already paid", 'Do you have a payment reference'],
    ['UTR 445566', 'will check it. Goodbye.'],
  ]);

  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'New from calls' }).click();
  await page.getByRole('row', { name: /E2E-F1/ }).click();
  const panel = page.getByRole('dialog', { name: 'E2E-F1' });
  const notes = panel.getByRole('region', { name: 'From calls' });
  await expect(notes).toContainText("It's already paid. UTR 445566");
  await expect(notes).toContainText('Payment: paid');
  await notes.getByRole('button', { name: 'Apply' }).click();
  await expect(notes).toContainText('Applied by Asha Owner');
  await expect(panel).toContainText('Checked by Asha Owner');
});

test('a follow-up stopped for want of a phone number starts again from "Call again" on its note', async ({ page }) => {
  test.setTimeout(120_000);
  const org = await newOrganization('wholesale-retail');
  await org.api.lists.removeSamples();
  const party = await org.api.lists.create('parties', { name: 'E2E No Phone Traders', partyType: 'retailer' });
  const bill = await org.api.lists.create('bills', { billNo: 'E2E-F2', billType: 'sales invoice', party: party.id, billDate: istDay(-10), dueDate: istDay(-3), total: 1000, paymentStatus: 'unpaid' });
  await org.api.followUps.switch('bills.unpaid-bills', true);
  await org.api.followUps.run();
  await expect.poll(async () => (await org.api.lists.item('bills', bill.id)).notes.length, { timeout: 30_000 }).toBe(1);

  await signInAs(page, org);
  await page.goto('/lists/bills');
  await page.getByRole('row', { name: /E2E-F2/ }).click();
  const notes = page.getByRole('dialog', { name: 'E2E-F2' }).getByRole('region', { name: 'From calls' });
  await expect(notes).toContainText('There is no phone number to call E2E No Phone Traders about E2E-F2');
  await expect(notes.getByRole('button', { name: 'Seen', exact: true })).toBeVisible();
  await notes.getByRole('button', { name: 'Call again', exact: true }).click();
  await expect(notes).toContainText('Seen by Asha Owner');
  // The follow-up is running again, so there is nothing stopped to start: the button goes.
  await expect(notes.getByRole('button', { name: 'Call again', exact: true })).toHaveCount(0);
});
