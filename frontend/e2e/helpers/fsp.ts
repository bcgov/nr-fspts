import { expect, type Page } from '@playwright/test';

import { gotoProtected } from '../utils';
import { type InMemoryFile, tinyPdfFile } from './tinyFiles';

/** ISO yyyy-mm-dd for today, used to fill decision/effective date pickers. */
export function isoToday(): string {
  // new Date() is fine in test code (unlike workflow scripts); keep it
  // simple and timezone-naive — the proc only stores the date part.
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Open the FSP Information page for a given id and wait for the header
 * (`FSP <id>`) to render. Optionally targets a specific amendment.
 */
export async function openFsp(
  page: Page,
  fspId: string,
  amendmentNumber?: string,
): Promise<void> {
  const qs = new URLSearchParams({ fspId });
  if (amendmentNumber) qs.set('amendmentNumber', amendmentNumber);
  await gotoProtected(page, `/fsp/information?${qs.toString()}`);
  await expect(page.getByRole('heading', { name: new RegExp(`FSP\\s+${fspId}\\b`) })).toBeVisible({
    timeout: 30_000,
  });
}

/** Switch to one of the FSP Information tabs by its visible label. */
export async function openFspTab(
  page: Page,
  name:
    | 'Information'
    | 'Attachments'
    | 'Stocking Standards'
    | 'FDU / Map'
    | 'History'
    | 'Workflow',
): Promise<void> {
  await page.getByRole('tab', { name, exact: true }).click();
}

/**
 * Add one attachment via the Attachments tab. Picks the category whose
 * label matches `categoryPattern` (falls back to the first real option
 * if nothing matches, since the category list is a per-FSP code list and
 * exact labels vary by environment). Returns the category text used so
 * the caller can assert on the resulting table row.
 */
export async function addAttachment(
  page: Page,
  file: InMemoryFile,
  categoryPattern: RegExp,
  description: string,
): Promise<string> {
  await openFspTab(page, 'Attachments');
  await page.getByRole('button', { name: 'Add Attachment' }).click();

  const modal = page.getByRole('dialog');
  // Target the heading specifically — "Add attachment" is also the primary
  // button's label, so a bare getByText matches two elements.
  await expect(
    modal.getByRole('heading', { name: 'Add attachment', exact: true }),
  ).toBeVisible();

  // Categories are fetched asynchronously when the dialog opens, so the
  // <select> starts with just the "— Select category —" placeholder and
  // fills in once the request resolves. Against the deployed env that
  // fetch is slower than the modal open, so wait for a real option to
  // appear before reading — otherwise we race the fetch and see only the
  // placeholder. Index 0 is always the placeholder, so > 1 option means at
  // least one real category is present.
  const categorySelect = modal.locator('#attachment-category');
  const options = categorySelect.locator('option');
  await expect
    .poll(() => options.count(), {
      timeout: 20_000,
      message: 'Attachment category options never loaded',
    })
    .toBeGreaterThan(1);

  // Resolve the category <option> by label, preferring the requested
  // pattern; fall back to the first real category.
  const optionTexts = await options.allTextContents();
  const selectable = optionTexts.filter((_t, i) => i > 0);
  const match =
    selectable.find((t) => categoryPattern.test(t)) ?? selectable[0];
  await categorySelect.selectOption({ label: match });

  // Carbon's "Browse" is a <label> wrapping the real input — set files
  // on the input itself, not the label.
  await modal.locator('input[type="file"]').setInputFiles({
    name: file.name,
    mimeType: file.mimeType,
    buffer: file.buffer,
  });
  await modal.getByLabel('Description').fill(description);

  await Promise.all([
    page.waitForResponse(
      (r) => /\/attachments\b/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 30_000 },
    ),
    modal.getByRole('button', { name: 'Add attachment', exact: true }).click(),
  ]);
  await expect(modal).toBeHidden({ timeout: 30_000 });
  return match;
}

/**
 * Record an Approve DDM decision from the Workflow tab. Assumes the FSP
 * is in a state where the DDM Decision tile is editable (SUB, or APP for
 * an admin). Fills decision + effective date with today and saves.
 */
export async function recordDdmApproval(page: Page): Promise<void> {
  await openFspTab(page, 'Workflow');
  // "Record decision" when no prior decision, "Edit decision" otherwise.
  await page
    .getByRole('button', { name: /Record decision|Edit decision/i })
    .first()
    .click();

  const modal = page.getByRole('dialog');
  // Heading is "Record DDM decision" / "Edit DDM decision" — case-insensitive
  // so a casing tweak in the modal title doesn't break this helper.
  await expect(modal.getByText(/Record DDM Decision|Edit DDM Decision/i)).toBeVisible();

  // "Approve" radio (value APP). Carbon renders the label as clickable text.
  await modal.getByText('Approve', { exact: true }).click();

  // All three dates are required (Submission is now editable). Effective is
  // shown + required because Approve is selected.
  const today = isoToday();
  await modal.getByLabel('Submission date', { exact: false }).fill(today);
  await modal.getByLabel('Decision date', { exact: false }).fill(today);
  await modal.getByLabel('Effective date', { exact: false }).fill(today);

  // Recording a decision requires the DDM decision letter; it's uploaded to
  // the FSP attachments after the decision saves. The modal has a single
  // file input (the letter dropzone).
  const letter = tinyPdfFile('e2e-ddm-decision-letter.pdf');
  await modal.locator('input[type="file"]').setInputFiles({
    name: letter.name,
    mimeType: letter.mimeType,
    buffer: letter.buffer,
  });

  await Promise.all([
    page.waitForResponse(
      (r) => /\/workflow\/action\b/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 30_000 },
    ),
    modal.getByRole('button', { name: /^Save/ }).click(),
  ]);
  await expect(modal).toBeHidden({ timeout: 30_000 });
}
