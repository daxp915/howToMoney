// Accessibility: axe-core on every place, desktop and phone (the phone project
// runs phone.spec.ts only, so this is desktop; contrast is width-independent).
// Serious and critical findings fail the build; moderate ones are listed in
// the report so they can be worked down without blocking every push.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const places = ['/', '/transactions', '/plan', '/plan?tab=recurring', '/plan?tab=goals', '/wealth', '/settings', '/settings/connections', '/security'];

for (const path of places) {
  test(`${path} has no serious accessibility problems`, async ({ page }, info) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const blocking = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const summary = result.violations.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(' ')}`);
    if (summary.length) await info.attach('axe', { body: summary.join('\n'), contentType: 'text/plain' });
    expect(blocking.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  });
}
