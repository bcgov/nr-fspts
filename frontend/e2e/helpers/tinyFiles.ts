import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * In-memory file payloads for Playwright's `setInputFiles`. Everything
 * here is deliberately tiny (bytes, not kilobytes) so that exercising
 * the real upload + persistence paths doesn't bloat the database — the
 * point of the e2e run is to prove the wiring, not to store documents.
 *
 * `setInputFiles` accepts `{ name, mimeType, buffer }`, so we never
 * touch a real file on disk for attachments; the XML submission is the
 * one exception (it reads the checked-in fixture and tokenises it).
 */
export interface InMemoryFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** A ~30-byte plain-text attachment. Stands in for a "DDM Decision" doc. */
export const tinyTextFile = (name = 'e2e-ddm-decision.txt'): InMemoryFile => ({
  name,
  mimeType: 'text/plain',
  buffer: Buffer.from('FSP e2e attachment — safe to delete.\n', 'utf-8'),
});

/**
 * The smallest structurally-valid single-page PDF (~300 bytes). Stands
 * in for the "FSP legal document". Hand-rolled rather than pulled from a
 * library so there's zero dependency and the bytes never grow.
 */
export const tinyPdfFile = (name = 'e2e-legal-document.pdf'): InMemoryFile => {
  const pdf = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj',
    'trailer<</Root 1 0 R>>',
    '%%EOF',
  ].join('\n');
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(pdf, 'latin1') };
};

/**
 * Reads the checked-in Initial-submission XML fixture and replaces its
 * `__PLAN_NAME__` / `__FDU_NAME__` tokens so each run creates a uniquely
 * named, self-contained FSP. Returned as an in-memory file the upload
 * input can consume directly.
 */
export const initialSubmissionXml = (
  suffix: string,
): InMemoryFile & { planName: string; fduName: string } => {
  const fixturePath = path.join(import.meta.dirname, '..', 'fixtures', 'initial-submission.xml');
  const planName = `E2E FSP ${suffix}`;
  const fduName = `E2E FDU ${suffix}`;
  const xml = readFileSync(fixturePath, 'utf-8')
    .replaceAll('__PLAN_NAME__', planName)
    .replaceAll('__FDU_NAME__', fduName);
  return {
    name: `initial-submission-${suffix}.xml`,
    mimeType: 'application/xml',
    buffer: Buffer.from(xml, 'utf-8'),
    planName,
    fduName,
  };
};
