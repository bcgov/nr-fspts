import { expect, test } from './fixtures';

import { gotoPage, PAGES } from './helpers/nav';
import { addAttachment, openFsp, openFspTab, recordDdmApproval } from './helpers/fsp';
import { initialSubmissionXml, tinyPdfFile } from './helpers/tinyFiles';
import { uniqueSuffix } from './utils';

/**
 * Full FSP lifecycle against the real backend, in order:
 *
 *   1. Upload + submit an Initial XML submission  → new Draft FSP
 *   2. Edit the FSP information                    → SAVE
 *   3. Attach a DDM-decision doc and a legal doc   → attachment rows
 *   4. Submit the FSP for approval                 → Draft → Submitted
 *   5. Record an Approve DDM decision              → Submitted → In Effect
 *   6. Amend the FSP                               → new Draft amendment
 *   7. Delete the amendment                        → back to the approved one
 *
 * Serial: each step depends on the previous, and the suite shares one
 * FSP id captured in step 1. A failure stops the chain (Playwright's
 * describe.serial) so we don't, e.g., try to approve an FSP that never
 * submitted.
 *
 * Requirements: a privileged storageState (Administrator + Decision
 * Maker, so the Workflow tab and approval are available) and a backend
 * whose reference tables contain the clients / district / licence in
 * e2e/fixtures/initial-submission.xml.
 */
test.describe.serial('FSP lifecycle', () => {
  const suffix = uniqueSuffix();
  const xml = initialSubmissionXml(suffix);
  let fspId = '';

  test('uploads and submits an XML file, creating a Draft FSP', async ({ page }) => {
    await gotoPage(page, PAGES.dataSubmission);

    // The submission FileUploader is the first file input on the page
    // (the attachments uploader follows it). Selecting a file triggers
    // the auto-validate effect.
    await page.locator('input[type="file"]').first().setInputFiles({
      name: xml.name,
      mimeType: xml.mimeType,
      buffer: xml.buffer,
    });

    // Wait for the validation pass to come back clean (Upload step, s4).
    await expect(page.getByText('New FSP submission validated')).toBeVisible({
      timeout: 60_000,
    });

    // Two-step wizard: advance to the Review step, then submit from there.
    await page.getByTestId('review-button').click();

    // Persist. The submit endpoint validates again then writes the FSP.
    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          /\/api\/v1\/fsp\/submissions\b/.test(r.url()) &&
          !/\/validate\b/.test(r.url()) &&
          r.request().method() === 'POST',
        { timeout: 90_000 },
      ),
      page.getByTestId('submit-button').click(),
    ]);
    expect(resp.status(), 'submission persist should answer 2xx').toBeLessThan(300);

    // Confirmation screen carries the assigned id; its action button
    // deep-links to the detail page where we read the id off the URL.
    const confirm = page.locator('.confirm-wrap');
    await expect(confirm.getByText('FSP draft saved')).toBeVisible({ timeout: 30_000 });
    await confirm.getByTestId('open-draft-button').click();
    await expect(page).toHaveURL(/\/fsp\/information\?fspId=\d+/, { timeout: 30_000 });
    fspId = new URL(page.url()).searchParams.get('fspId') ?? '';
    expect(fspId, 'captured fspId').toMatch(/^\d+$/);

    await expect(page.getByText('Draft', { exact: false }).first()).toBeVisible();
  });

  test('edits the FSP information', async ({ page }) => {
    await openFsp(page, fspId);
    await openFspTab(page, 'Information');

    await page.getByRole('button', { name: 'Edit plan details', exact: true }).click();

    const planName = page.locator('#edit-fspPlanName');
    await expect(planName).toBeVisible();
    await planName.fill(`${xml.planName} (edited)`);

    await Promise.all([
      page.waitForResponse(
        (r) =>
          new RegExp(`/api/v1/fsp/${fspId}\\b`).test(r.url()) &&
          r.request().method() === 'PUT',
        { timeout: 30_000 },
      ),
      page.getByRole('button', { name: 'Save changes', exact: true }).click(),
    ]);

    // Edit mode closes on success — the Edit button comes back.
    await expect(
      page.getByRole('button', { name: 'Edit plan details', exact: true }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('attaches a DDM decision document and an FSP legal document', async ({ page }) => {
    await openFsp(page, fspId);

    // Attachments only accept .pdf/.doc/.docx, so both use the tiny PDF.
    // "DDM Decision Letter" category.
    await addAttachment(
      page,
      tinyPdfFile('e2e-ddm-decision.pdf'),
      /DDM|decision/i,
      `e2e DDM decision ${suffix}`,
    );
    // "FSP legal document" category.
    await addAttachment(
      page,
      tinyPdfFile('e2e-legal-document.pdf'),
      /legal/i,
      `e2e legal document ${suffix}`,
    );

    // Both rows now show in the attachments table.
    await openFspTab(page, 'Attachments');
    await expect(page.getByRole('cell', { name: `e2e DDM decision ${suffix}` })).toBeVisible();
    await expect(page.getByRole('cell', { name: `e2e legal document ${suffix}` })).toBeVisible();
  });

  test('submits the FSP for approval', async ({ page }) => {
    await openFsp(page, fspId);

    await page.getByRole('button', { name: 'Submit FSP' }).click();
    const modal = page.getByRole('dialog');
    // Preflight runs inside the modal; once clean the Submit button enables.
    await Promise.all([
      page.waitForResponse(
        (r) =>
          new RegExp(`/api/v1/fsp/${fspId}/submit\\b`).test(r.url()) &&
          r.request().method() === 'POST',
        { timeout: 60_000 },
      ),
      modal.getByRole('button', { name: 'Submit', exact: true }).click(),
    ]);

    // Status moves off Draft (Submitted, or In Effect if no approval was
    // required — either way, not Draft).
    await openFsp(page, fspId);
    await expect(page.getByText('Draft', { exact: true })).toHaveCount(0, { timeout: 30_000 });
  });

  test('approves the FSP via a DDM decision', async ({ page }) => {
    await openFsp(page, fspId);
    await recordDdmApproval(page);

    // The DDM tile now reflects the recorded decision. Since the FSP is
    // approved (no longer Submitted), the decision is read-only: the tile
    // renders its details ("Decided by" only appears once a decision exists)
    // but exposes NO Edit/Record button — edit/record is gated to Submitted
    // status (see WorkflowDataTab.allowedDdmDecisions / enableDdmEdit).
    await openFspTab(page, 'Workflow');
    await expect(page.getByText('Decided by')).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('button', { name: /Record decision|Edit decision/i }),
    ).toHaveCount(0);
  });

  test('amends the FSP', async ({ page }) => {
    await openFsp(page, fspId);

    await page.getByRole('button', { name: 'Amend FSP' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText('Amend FSP')).toBeVisible();

    // All fields are required: answer the FDU-boundaries, stocking-standards,
    // and approval Y/N questions (No for a plain test amendment). Carbon
    // radios are visually hidden inputs, so click their <label for=…>.
    await modal.locator('label[for="create-amend-fdu-no"]').click();
    await modal.locator('label[for="create-amend-stocking-no"]').click();
    await modal.locator('label[for="create-amend-approval-no"]').click();

    // Summary of changes is required by the amendment proc. The textarea
    // isn't label-associated (its accessible name is the placeholder), so
    // target it by id (namespaced per mode: create-amend).
    await modal.locator('#create-amend-reason').fill(`e2e amendment ${suffix}`);
    await Promise.all([
      page.waitForResponse(
        (r) =>
          new RegExp(`/api/v1/fsp/${fspId}`).test(r.url()) &&
          ['POST', 'PUT'].includes(r.request().method()),
        { timeout: 60_000 },
      ),
      modal.getByRole('button', { name: /Create amendment/ }).click(),
    ]);

    // We land on the new Draft amendment (amendment picker > 0, Delete
    // Amendment available).
    await expect(page.getByRole('button', { name: 'Delete Amendment' })).toBeVisible({
      timeout: 30_000,
    });
  });

  test('deletes the amendment', async ({ page }) => {
    // Fresh page per test — re-open the FSP. With no amendmentNumber the
    // GET resolves the latest amendment, which is the draft we just
    // created, so the Delete Amendment affordance is present.
    await openFsp(page, fspId);
    await expect(page.getByRole('button', { name: 'Delete Amendment' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Delete Amendment' }).click();

    const confirm = page.getByRole('dialog');
    await expect(confirm.getByText('Delete this amendment?')).toBeVisible();
    await Promise.all([
      page.waitForResponse(
        (r) =>
          new RegExp(`/api/v1/fsp/${fspId}`).test(r.url()) &&
          r.request().method() === 'DELETE',
        { timeout: 30_000 },
      ),
      // Carbon prefixes the danger-kind button's accessible name with
      // "danger", so match on the substring rather than exact.
      confirm.getByRole('button', { name: 'Delete' }).click(),
    ]);

    // Back on the surviving approved amendment — no Delete Amendment
    // affordance (it's not a Draft), and the FSP id is unchanged.
    await expect(page).toHaveURL(new RegExp(`fspId=${fspId}\\b`), { timeout: 30_000 });
  });
});
