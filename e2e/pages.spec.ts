// Every place loads without a server error or an uncaught exception, old URLs
// still land somewhere, and Hide amounts actually hides them.
import { test, expect } from '@playwright/test';

const places = ['/', '/transactions', '/plan', '/plan?tab=recurring', '/plan?tab=goals', '/wealth', '/settings', '/settings/connections', '/settings/categories', '/settings/rules', '/advisor'];

for (const path of places) {
  test(`${path} renders cleanly`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const res = await page.goto(path);
    expect(res?.status(), 'HTTP status').toBeLessThan(400);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main')).toBeVisible();
    expect(errors, 'uncaught exceptions in the page').toEqual([]);
  });
}

// v2 folded 13 tabs into four; every old route redirects (moved()), never 404s.
const moved: [string, RegExp][] = [
  ['/budgets', /\/plan/],
  ['/recurring', /\/plan\?tab=recurring/],
  ['/goals', /\/plan\?tab=goals/],
  ['/review', /\/transactions\?review=1/],
  ['/cashflow', /\/transactions/],
  ['/categories', /\/settings\/categories/],
  ['/rules', /\/settings\/rules/],
  ['/connect', /\/settings\/connections/],
  ['/import', /\/settings\/import/]
];

for (const [from, to] of moved) {
  test(`${from} redirects`, async ({ page }) => {
    const res = await page.goto(from);
    expect(res?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(to);
  });
}

test('Hide amounts masks every figure and survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Hide amounts' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('data-hide-amounts', /.*/);
  // The mask is CSS: every HTML .amt draws "$•••" over its clipped digits.
  // (SVG figures blur instead, and CSS cannot be asked whether a blur reads.)
  const unmasked = await page.$$eval('.amt', (els) =>
    els
      .filter((e) => !(e instanceof SVGElement) && (e as HTMLElement).offsetParent !== null)
      .filter((e) => getComputedStyle(e, '::before').content !== '"$•••"')
      .map((e) => (e as HTMLElement).innerText)
  );
  expect(unmasked, 'figures still showing').toEqual([]);
  // hooks.server.ts writes the attribute from the cookie, so the first byte is masked.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-hide-amounts', /.*/);
  await page.getByRole('button', { name: 'Show amounts' }).first().click();
});
