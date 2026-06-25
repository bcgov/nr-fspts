import { expect, test } from '@playwright/test';

import { gotoPage, PAGES } from './helpers/nav';

/**
 * District Notification admin flow: add an individual IDIR designate to
 * a district, confirm they appear, then remove them and confirm they're
 * gone. Real backend (FAM identity lookup + the district-notification
 * proc), so it needs:
 *
 *   * an admin (FSPTS_ADMINISTRATOR) storageState, and
 *   * a real IDIR username to look up — set E2E_DISTRICT_DESIGNATE, or
 *     we fall back to the E2E_IDIR_USER login account (which is
 *     guaranteed to exist in FAM).
 *
 * Non-destructive: if the chosen user is ALREADY a designate on the
 * first org unit we skip rather than delete real configuration.
 */
const designateQuery = process.env.E2E_DISTRICT_DESIGNATE ?? process.env.E2E_IDIR_USER ?? '';

test.describe('District Notification', () => {
  test.skip(
    !designateQuery,
    'Set E2E_DISTRICT_DESIGNATE (or E2E_IDIR_USER) to an IDIR username to run this test.',
  );

  test('adds an individual to a district then removes them', async ({ page }) => {
    await gotoPage(page, PAGES.districtNotification);

    // Choosing a district fires the designate load (no Search button).
    const district = page.locator('#district-orgUnit');
    await Promise.all([
      page.waitForResponse(
        (r) =>
          /\/api\/v1\/fsp\/admin\/district-notifications\b/.test(r.url()) &&
          r.request().method() === 'GET',
        { timeout: 30_000 },
      ),
      district.selectOption({ index: 1 }),
    ]);

    const usernameRe = new RegExp(designateQuery.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'), 'i');
    const designateRow = page.getByRole('row', { name: usernameRe });

    // Guard: don't clobber a real, pre-existing designate.
    if (await designateRow.count()) {
      test.skip(true, `${designateQuery} is already a designate on this district — skipping.`);
    }

    // ── Add ──
    await page.getByRole('button', { name: 'Add user…' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText('Find IDIR user')).toBeVisible();

    await modal.getByLabel('User ID').fill(designateQuery);
    await Promise.all([
      page.waitForResponse(
        (r) =>
          /\/api\/v1\/fsp\/users\/search\b/.test(r.url()) && r.request().method() === 'GET',
        { timeout: 30_000 },
      ),
      modal.getByRole('button', { name: 'Search', exact: true }).click(),
    ]);

    await Promise.all([
      page.waitForResponse(
        (r) =>
          /\/api\/v1\/fsp\/admin\/district-notifications\b/.test(r.url()) &&
          r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      modal.getByRole('button', { name: 'Select' }).first().click(),
    ]);

    await expect(designateRow).toBeVisible({ timeout: 30_000 });

    // ── Remove ──
    await designateRow.getByRole('button', { name: 'Remove' }).click();
    const confirm = page.getByRole('dialog');
    await expect(confirm.getByText('Remove designate?')).toBeVisible();
    await Promise.all([
      page.waitForResponse(
        (r) =>
          /\/api\/v1\/fsp\/admin\/district-notifications\//.test(r.url()) &&
          r.request().method() === 'DELETE',
        { timeout: 30_000 },
      ),
      // Carbon prefixes the danger button's name with "danger".
      confirm.getByRole('button', { name: 'Remove' }).click(),
    ]);

    await expect(designateRow).toHaveCount(0, { timeout: 30_000 });
  });
});
