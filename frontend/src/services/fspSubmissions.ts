import {apiFetch} from '@/services/apiFetch';
import type {FspInformation} from '@/services/fspSearch';

/**
 * Mirrors backend SubmissionValidationError (record).
 *   - {@code code}: short machine token (XSD, JAXB, GEOMETRY_INVALID,
 *     ENVELOPE_UNRECOGNIZED, etc.)
 *   - {@code path}: when known, an XPath-style or "line N, col M"
 *     locator; null when the error doesn't bind to a location.
 *   - {@code message}: human-readable text from the parser/validator.
 */
export interface SubmissionValidationError {
  path: string | null;
  code: string;
  message: string;
}

/** Mirrors backend SubmissionValidationResult. */
export interface SubmissionValidationResult {
  valid: boolean;
  errors: SubmissionValidationError[];
}

/**
 * Result of POST /v1/fsp/submissions — discriminated union so the
 * UI can branch cleanly on success vs validation failure vs other
 * HTTP errors without re-inspecting status codes.
 */
export type SubmissionOutcome =
  | { kind: 'created'; saved: FspInformation }
  | { kind: 'invalid'; result: SubmissionValidationResult }
  | { kind: 'error'; status: number; message: string };

/**
 * Build a multipart payload for the submission endpoints. Browser
 * auto-sets the {@code Content-Type: multipart/form-data; boundary=…}
 * header — don't override it, the boundary token has to come from the
 * fetch implementation.
 */
const buildFormData = (xml: File, attachments?: File[]): FormData => {
  const form = new FormData();
  form.append('file', xml);
  attachments?.forEach((a) => {
    if (a && a.size > 0) {
      form.append('attachments', a);
    }
  });
  return form;
};

/**
 * POST /v1/fsp/submissions/validate — read-only dry-run. Returns
 * the structured validation result whether the XML passes or not.
 * Non-200/422 statuses (e.g. 401) are still surfaced via a thrown
 * Error so the caller can show a generic auth/network failure.
 */
export const validateSubmission = async (
  xml: File,
): Promise<SubmissionValidationResult> => {
  const res = await apiFetch('/v1/fsp/submissions/validate', {
    method: 'POST',
    body: buildFormData(xml),
  });
  if (res.status === 200 || res.status === 422) {
    return (await res.json()) as SubmissionValidationResult;
  }
  const detail = await res.text().catch(() => '');
  throw new Error(
    detail
      ? `Validation request failed (${res.status}): ${detail}`
      : `Validation request failed (${res.status})`,
  );
};

/**
 * POST /v1/fsp/submissions — validate then persist in a single
 * transaction. On 201 the response body is the saved FSP record (with
 * the proc-assigned fspId for new submissions). On 422 the body is the
 * structured validation result.
 */
export const submitSubmission = async (
  xml: File,
  attachments: File[] = [],
): Promise<SubmissionOutcome> => {
  const res = await apiFetch('/v1/fsp/submissions', {
    method: 'POST',
    body: buildFormData(xml, attachments),
  });

  if (res.status === 201) {
    const saved = (await res.json()) as FspInformation;
    return { kind: 'created', saved };
  }
  if (res.status === 422) {
    const result = (await res.json()) as SubmissionValidationResult;
    return { kind: 'invalid', result };
  }
  const detail = await res.text().catch(() => '');
  return {
    kind: 'error',
    status: res.status,
    message:
      detail ||
      `Submission request failed (${res.status})`,
  };
};
