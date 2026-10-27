// At phone width nothing scrolls sideways ("A grid track's minimum
// is its content's width"). One wide child clips every card below it.
import { test, expect } from '@playwright/test';

const places = ['/', '/transactions', '/plan', '/plan?tab=recurring', '/plan?tab=goals', '/wealth', '/settings'];

for (const path of places) {
  test(`${path} fits a 402px phone`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const { scroll, client, widest } = await page.evaluate(() => {
      const root = document.documentElement;
      // body has overflow-x: hidden, so scrollWidth alone can hide the bug;
      // look for any element that passes either edge of the viewport too.
      let widest = '';
      for (const el of document.querySelectorAll('main *')) {
        const r = el.getBoundingClientRect();
        const out = r.right > root.clientWidth + 1 || r.left < -1;
        if (r.width > 0 && out && getComputedStyle(el).position !== 'fixed') {
          widest = `${el.tagName.toLowerCase()}.${(el as HTMLElement).className} left=${Math.round(r.left)} right=${Math.round(r.right)}`;
          break;
        }
      }
      return { scroll: root.scrollWidth, client: root.clientWidth, widest };
    });
    expect(scroll).toBeLessThanOrEqual(client);
    expect(widest, 'an element overflows the viewport').toBe('');
  });
}
