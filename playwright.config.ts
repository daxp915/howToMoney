// End-to-end tests against the demo household (`npm run demo:seed`).
//
// Locally, run the app against the demo database the way scripts/seed-demo.ts
// describes (port 5174), then:
//
//   E2E_BASE_URL=http://localhost:5174 npx playwright test
//
// In CI the workflow builds the app and Playwright starts it itself (webServer
// below), against a demo database the job seeded a step earlier.
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const auth = 'e2e/.auth/demo.json';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop',
      testIgnore: /phone\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 }, storageState: auth },
      dependencies: ['setup']
    },
    {
      // 402 wide, touch, iOS user agent: the width every layout bug so far
      // has shown up at. Chromium rather than WebKit keeps CI to one browser.
      name: 'phone',
      testMatch: /phone\.spec\.ts/,
      use: {
        ...devices['iPhone 15 Pro'],
        defaultBrowserType: 'chromium',
        viewport: { width: 402, height: 874 },
        storageState: auth
      },
      dependencies: ['setup']
    }
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node build/index.js',
        url: baseURL + '/login',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000
      }
});
