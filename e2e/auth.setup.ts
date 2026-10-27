// Signs in once as the demo household and saves the cookie for every test.
import { test as setup, expect } from '@playwright/test';

setup('sign in as the demo household', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name=email]', 'demo@example.com');
  await page.fill('input[name=password]', 'demo-password');
  await page.click('button[type=submit]');
  await expect(page).not.toHaveURL(/\/login/);
  await page.context().storageState({ path: 'e2e/.auth/demo.json' });
});
