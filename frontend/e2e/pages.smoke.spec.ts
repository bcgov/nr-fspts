import { expect, test } from '@playwright/test';

import { gotoPage, navClick, PAGES } from './helpers/nav';

/**
 * Page-level smoke coverage against the real backend. Walks every
 * top-level route and asserts its <h1> renders — the cheapest signal
 * that auth resolved, the bundle mounted, and the page's first data
 * call didn't hard-fail. Feature behaviour lives in the dedicated
 * specs; this is the "nothing is white-screened" net.
 *
 * Runs serially under one worker (see playwright.config.ts) so it
 * shares the cached IDIR storageState without racing token refresh.
 */
test.describe('Page smoke', () => {
  // Reachable from the SideNav for a privileged (non-submitter) user.
  for (const [key, def] of Object.entries(PAGES)) {
    // Submission History is client-tied (Submitter / View Only only); the
    // smoke suite runs as an internal IDIR user, so it can't reach it.
    if (key === 'submissionHistory') continue;
    test(`renders ${key} (${def.path})`, async ({ page }) => {
      await gotoPage(page, def);
    });
  }

  test('SideNav navigates to FSP Search', async ({ page }) => {
    // Land somewhere first, then drive the menu itself.
    await gotoPage(page, PAGES.inbox);
    await navClick(page, PAGES.fspSearch);
  });

  test('unknown FSP id shows a not-found message, not a crash', async ({ page }) => {
    // Deep-link to an FSP that won't exist; the page should render its
    // "was not found" branch rather than white-screen.
    await page.goto('/fsp/information?fspId=0');
    await expect(page.getByText(/was not found|not found/i)).toBeVisible({ timeout: 30_000 });
  });
});
