import { expect, test } from '@playwright/test';

import { gotoPage, PAGES } from './helpers/nav';

/**
 * Reports (JCRS) coverage. Opens the FSP Summary report accordion,
 * selects an org unit (required for that report), generates the PDF,
 * and asserts the render endpoint answers 200 with a PDF body.
 *
 * Verifying the response rather than a browser download keeps this
 * deterministic — we don't depend on the OS download dialog or a
 * popup, just the proc-backed POST the form fires.
 */
test.describe('Reports', () => {
  test('FSP Summary report generates a PDF', async ({ page }) => {
    await gotoPage(page, PAGES.reports);

    // Expand the FSP Summary accordion (header band carries the title).
    await page.getByRole('button', { name: /FSP Summary Report/ }).click();

    // Org unit is required for this report; pick the first real option
    // (index 0 is the placeholder).
    const orgSelect = page.locator('#report-fsp-summary-orgUnit');
    await expect(orgSelect).toBeVisible({ timeout: 30_000 });
    await orgSelect.selectOption({ index: 1 });

    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          /\/api\/v1\/fsp\/reports\/fsp-summary\b/.test(r.url()) &&
          r.request().method() === 'POST',
        { timeout: 90_000 },
      ),
      page.getByRole('button', { name: 'Generate PDF' }).click(),
    ]);

    expect(resp.status(), 'report endpoint should answer 200').toBe(200);
    expect.soft(
      resp.headers()['content-type'] ?? '',
      'report should be a PDF',
    ).toMatch(/pdf/i);
  });
});
