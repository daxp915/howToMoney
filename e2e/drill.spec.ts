// Every figure that is a sum of transactions links to those rows, and the list
// it opens must add up to it.
import { test, expect, type Page } from '@playwright/test';

const num = (s: string | null) => Number(String(s).replace(/[^0-9.\-−]/g, '').replace('−', '-'));

type Fig = { label: string; href: string | null; fig: string | null };

async function grab(page: Page, path: string, rowSel: string, linkSel: string): Promise<Fig[]> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  return page.$$eval(
    rowSel,
    (els, sel) =>
      els.map((e) => {
        const a = e.querySelector(sel);
        return {
          label: (e.textContent ?? '').trim().slice(0, 40),
          href: a?.getAttribute('href') ?? null,
          fig: a?.textContent ?? null
        };
      }),
    linkSel
  );
}

async function expectListSumsTo(page: Page, f: Fig) {
  const expected = num(f.fig);
  await page.goto(f.href!);
  const got = num(await page.locator('.drill-sum').textContent());
  // Budgets and heroes show whole dollars, so those match to the dollar.
  const tolerance = Number.isInteger(expected) ? 0.5 : 0.005;
  expect.soft(Math.abs(Math.abs(got) - Math.abs(expected)), `${f.label} → ${f.href}`).toBeLessThanOrEqual(tolerance);
}

const surfaces: [string, string, string, string][] = [
  ['Home budgets', '/', '.crow', '.spent a'],
  ['Activity hero', '/transactions', '.big, .line', 'a.figure'],
  ['Plan envelopes', '/plan', '.crow', '.spent a'],
  ['Activity month cards', '/transactions', '.trio > div', 'a.figure']
];

for (const [name, path, rowSel, linkSel] of surfaces) {
  test(`${name}: every figure equals the list it opens`, async ({ page }) => {
    const figs = (await grab(page, path, rowSel, linkSel)).filter((f) => f.href && !/Kept/.test(f.label));
    expect(figs.length, `no linked figures found on ${path}`).toBeGreaterThan(0);
    for (const f of figs) await expectListSumsTo(page, f);
  });
}
