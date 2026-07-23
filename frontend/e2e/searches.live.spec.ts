import { expect, test, type Page } from './fixtures';

import { gotoPage, PAGES } from './helpers/nav';

/**
 * Real-backend search coverage for the three search surfaces (FSP,
 * Inbox, Stocking Standards). Distinct from search.spec.ts /
 * inbox.spec.ts, which mock the API to pin UI behaviour — here we run an
 * actual query end-to-end and assert the proc-backed endpoint answers
 * 200 and the results region renders (rows or a clean empty state).
 *
 * We submit with no criteria: each proc returns the caller's visible
 * working set, which is the broadest, most environment-independent
 * query we can make without seeding data.
 */

async function expectSearchOk(
  page: Page,
  endpoint: RegExp,
  trigger: () => Promise<void>,
): Promise<void> {
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => endpoint.test(r.url()) && r.request().method() === 'GET',
      { timeout: 60_000 },
    ),
    trigger(),
  ]);
  expect(resp.status(), `${endpoint} should answer 200`).toBe(200);
}

test.describe('Search surfaces (live)', () => {
  test('FSP Search runs a query and renders results', async ({ page }) => {
    await gotoPage(page, PAGES.fspSearch);
    await expectSearchOk(page, /\/api\/v1\/fsp\/search\b/, () =>
      page.locator('.fsp-search__form').getByRole('button', { name: 'Search', exact: true }).click(),
    );
    // Results header ("N results found") renders whenever a search has
    // run, for any count — so it's a count-agnostic "query completed".
    await expect(page.getByText(/\bresults?\s+found\b/i)).toBeVisible({ timeout: 30_000 });
  });

  test('Inbox runs a query and renders results', async ({ page }) => {
    await gotoPage(page, PAGES.inbox);
    await expectSearchOk(page, /\/api\/v1\/fsp\/inbox\b/, () =>
      page.locator('.fsp-inbox__form').getByRole('button', { name: 'Search', exact: true }).click(),
    );
    await expect(page.getByText(/\bitems?\s+found\b/i)).toBeVisible({ timeout: 30_000 });
  });

  test('Stocking Standards Search runs a query and renders results', async ({ page }) => {
    await gotoPage(page, PAGES.standardsSearch);
    await expectSearchOk(page, /\/api\/v1\/fsp\/standards\/search\b/, () =>
      page.locator('.fsp-search__form').getByRole('button', { name: 'Search', exact: true }).click(),
    );
    // Either a results header or the "no regimes matched" empty state is
    // an acceptable "the query ran" signal.
    await expect(
      page.getByText(/\bfound\b|No standards regimes matched/i).first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});
