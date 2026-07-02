import { expect, type Page } from '@playwright/test';

import { gotoProtected } from '../utils';
import { type InMemoryFile } from './tinyFiles';

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
  await expect(modal.getByText('Add Attachment')).toBeVisible();

  // Resolve the category <option> by label, preferring the requested
  // pattern. Index 0 is the "— Select category —" placeholder.
  const categorySelect = modal.locator('#attachment-category');
  const optionTexts = await categorySelect.locator('option').allTextContents();
  const match =
    optionTexts.find((t) => categoryPattern.test(t)) ??
    optionTexts.find((_t, i) => i > 0) ??
    '';
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
    modal.getByRole('button', { name: 'Save', exact: true }).click(),
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
  // "Record Decision" when no prior decision, "Edit Decision" otherwise.
  await page
    .getByRole('button', { name: /Record Decision|Edit Decision/ })
    .first()
    .click();

  const modal = page.getByRole('dialog');
  // Heading is "Record DDM decision" / "Edit DDM decision" — case-insensitive
  // so a casing tweak in the modal title doesn't break this helper.
  await expect(modal.getByText(/Record DDM Decision|Edit DDM Decision/i)).toBeVisible();

  // "Approve" radio (value APP). Carbon renders the label as clickable text.
  await modal.getByText('Approve', { exact: true }).click();

  const today = isoToday();
  await modal.getByLabel('Decision Date', { exact: false }).fill(today);
  await modal.getByLabel('Effective Date', { exact: false }).fill(today);

  await Promise.all([
    page.waitForResponse(
      (r) => /\/workflow\/action\b/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 30_000 },
    ),
    modal.getByRole('button', { name: /^Save/ }).click(),
  ]);
  await expect(modal).toBeHidden({ timeout: 30_000 });
}
