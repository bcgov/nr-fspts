/**
 * Constraints shared by every attachment-upload widget — FSP Attachments
 * tab (per-FSP attachment management) and the Data Submission screen
 * (attachments accompanying an XML/GeoJSON submission). Keep both
 * uploaders in lockstep by importing from this module rather than
 * redeclaring locally.
 *
 * The 50-byte filename cap matches the database column width
 * (FSP_ATTACHMENT.FILE_NAME VARCHAR2(50)); an over-50-char filename
 * would otherwise blow up mid-upload with ORA-12899.
 */

/** Allow-list of file extensions, lowercase with leading dot. */
export const ACCEPTED_ATTACHMENT_EXTENSIONS: readonly string[] = [
  '.pdf',
  '.doc',
  '.docx',
];

/** Max filename length including the extension. Matches DB column. */
export const MAX_ATTACHMENT_FILENAME_LEN = 50;

/** Per-file upload cap, in bytes (50 MB). */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Case-insensitive `endsWith` check against the allow-list. */
export const hasAcceptedAttachmentExtension = (filename: string): boolean => {
  const lower = filename.toLowerCase();
  return ACCEPTED_ATTACHMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

/**
 * Validate one file against all three constraints in order: extension,
 * filename length, size. Returns the first problem's user-facing
 * `{ title, subtitle }` toast payload, or null on success.
 */
export const validateAttachmentFile = (
  file: File,
): { title: string; subtitle: string } | null => {
  if (!hasAcceptedAttachmentExtension(file.name)) {
    return {
      title: 'Unsupported file type',
      subtitle: `Allowed: ${ACCEPTED_ATTACHMENT_EXTENSIONS.join(', ')}.`,
    };
  }
  if (file.name.length > MAX_ATTACHMENT_FILENAME_LEN) {
    return {
      title: 'File name too long',
      subtitle:
        `Max ${MAX_ATTACHMENT_FILENAME_LEN} characters including the extension `
        + `(this file has ${file.name.length}). Rename and try again.`,
    };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      title: 'File too large',
      subtitle: `Max 50 MB (${(file.size / 1_048_576).toFixed(1)} MB)`,
    };
  }
  return null;
};
