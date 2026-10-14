import { expect, test } from '@playwright/test';

/**
 * public/browser-check.js says "This page couldn't start in this browser" when
 * the app never draws. It must never cover a working app: moving between
 * screens can leave the page empty for a moment (a redirect while the next
 * screen's code downloads), and that moment can land on the check.
 */

const note = (page: import('@playwright/test').Page) => page.getByRole('heading', { name: "This page couldn't start in this browser" });

test('never shows over a working app, even if the page is empty for a moment when the check runs', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /Sign in/ })).toBeVisible();
  // The empty moment between two screens, held across the check (4 s after load).
  const kept = await page.evaluate(() => {
    const root = document.getElementById('root')!;
    const children = Array.from(root.childNodes);
    root.replaceChildren();
    return new Promise<number>((resolve) =>
      setTimeout(() => {
        root.replaceChildren(...children);
        resolve(children.length);
      }, 4500),
    );
  });
  expect(kept).toBeGreaterThan(0);
  await expect(note(page)).toBeHidden();
});

test("shows when the app's code can't run at all, so the page isn't left blank", async ({ page }) => {
  await page.route(/\/(src\/main\.tsx|assets\/index-[^/]+\.js)(\?.*)?$/, (route) => route.abort());
  await page.goto('/login');
  await expect(note(page)).toBeVisible({ timeout: 10_000 });
});
