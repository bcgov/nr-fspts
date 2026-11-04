import { defineConfig, devices } from '@playwright/test';

import { baseURL, STORAGE_STATE } from './e2e/utils';

/**
 * Playwright E2E config — mirrors nr-rept's structure.
 *
 * Auth flow:
 *   1. `npm run e2e:login` runs the `setup` project headed, parks at the IDIR
 *      login page, and saves cookies + localStorage to e2e/.auth/user.json
 *      once you successfully sign in.
 *   2. All other projects start from that storageState so each test boots
 *      already-authenticated.
 *
 * Override the target with E2E_BASE_URL (e.g. http://localhost:3000 for local).
 */
export default defineConfig({
  // 60s is a generous ceiling for a single test against the shared, slower
  // TEST/preview infra — the proc-heavy flows still finish well under it.
  // Keeping it tight bounds the blast radius of any hang: with retries: 2 a
  // stuck test now costs ~3 min instead of ~9, and fails legibly rather than
  // masquerading as "slow CI".
  timeout: 60_000,
  testDir: './e2e',
  // Serial execution. We share one rotating Keycloak refresh token across
  // specs (see e2e/fixtures.ts); parallel workers race that renewal and
  // intermittently leave some contexts stuck on the white `<Loading>` overlay.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['line'], ['list', { printSteps: true }], ['html', { open: 'never' }]],
  use: {
    baseURL,
    // Never trace in CI. Every trace embeds the context's storageState, i.e.
    // the e2e account's Keycloak SSO cookies and tokens, and CI uploads
    // playwright-report as an artifact on a public repo. Playwright offers no
    // way to scrub it. Reproduce locally with traces instead.
    trace: process.env.CI ? 'off' : 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      // No trace, screenshot or video for sign-in. A trace records every
      // action's arguments verbatim (Playwright redacts nothing), so a retried
      // setup would write the IDIR password into playwright-report, which CI
      // uploads as an artifact on a public repo. A screenshot can catch the
      // MFA page. Debug sign-in locally instead.
      use: { ...devices['Desktop Chrome'], trace: 'off', screenshot: 'off', video: 'off' },
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE,
      },
      dependencies: ['setup'],
    },
    {
      name: 'Google Chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        storageState: STORAGE_STATE,
      },
      dependencies: ['setup'],
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        storageState: STORAGE_STATE,
      },
      dependencies: ['setup'],
    },
    {
      name: 'safari',
      use: {
        ...devices['Desktop Safari'],
        storageState: STORAGE_STATE,
      },
      dependencies: ['setup'],
    },
    {
      name: 'Microsoft Edge',
      use: {
        ...devices['Desktop Edge'],
        channel: 'msedge',
        storageState: STORAGE_STATE,
      },
      dependencies: ['setup'],
    },
  ],
});
