import { defineConfig, devices } from '@playwright/test';

/**
 * Minimal Playwright E2E config — mirrors nr-rept's structure but without
 * the auth setup project (FSP doesn't have Cognito/IDIR wired up to e2e yet).
 *
 * The reusable-tests.yml workflow runs `playwright test --project=chromium`
 * with E2E_BASE_URL pointing at the deployed PR/TEST/PROD frontend. Add
 * real specs to e2e/ as the FSP feature surface stabilises.
 */
export default defineConfig({
  timeout: 180_000,
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['line'], ['list', { printSteps: true }], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
