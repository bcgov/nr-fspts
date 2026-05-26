import { existsSync } from 'node:fs';

import { test as setup, expect } from '@playwright/test';

import { STORAGE_STATE } from './utils';

/**
 * Auth setup. Runs once per `playwright test` invocation, as a dependency of
 * every browser project. Three behaviours, in priority order:
 *
 *   1. e2e/.auth/user.json already exists → do nothing (cached state).
 *   2. E2E_IDIR_USER + E2E_IDIR_PASSWORD env vars are set → drive IDIR
 *      login programmatically. Used in CI (reusable-tests.yml passes these
 *      from GitHub Actions secrets).
 *   3. Neither of the above → fall back to the interactive flow: open the
 *      headed browser and wait up to 5 minutes for a human to complete the
 *      IDIR sign-in. Used locally via `npm run e2e:login`.
 *
 * Re-run `npm run e2e:login` whenever the saved Cognito tokens expire
 * (symptom: tests bouncing to the IDIR domain or hitting 401s).
 */
setup('authenticate via IDIR', async ({ page }) => {
  if (existsSync(STORAGE_STATE)) {
    return;
  }

  const idirUser = process.env.E2E_IDIR_USER;
  const idirPassword = process.env.E2E_IDIR_PASSWORD;
  const programmatic = Boolean(idirUser && idirPassword);

  await page.goto('/');
  await page.getByTestId('landing-button__idir').click();

  if (programmatic) {
    // The BC Gov SSO login page is on a different origin than the SPA.
    // Selectors below match the Logon7 / IDIR login form fields. If the
    // upstream form ever changes its `name` attributes, this is the place
    // to update them.
    await page.waitForURL(/logon|loginproxy|amazoncognito/i, { timeout: 60_000 });

    await page.locator('input[name="user"]').fill(idirUser!);
    await page.locator('input[name="password"]').fill(idirPassword!);
    await page.locator('input[type="submit"], button[type="submit"]').first().click();
  }

  // Whether interactive or programmatic, we wait for the redirect back to
  // /welcome (FSP's post-login landing — REPT used /dashboard).
  // Interactive flow gets 5 min for human; programmatic gets 2.
  await page.waitForURL((url) => url.pathname.startsWith('/welcome'), {
    timeout: programmatic ? 2 * 60_000 : 5 * 60_000,
  });

  // Sanity check: the side menu should render once auth + roles resolve.
  // Inbox is the first universally-visible top-level entry for any
  // authenticated FSP user, so it's the simplest "auth landed cleanly"
  // signal.
  await expect(page.getByTestId('side-nav-link-Inbox')).toBeVisible({
    timeout: 30_000,
  });

  await page.context().storageState({ path: STORAGE_STATE });
});
