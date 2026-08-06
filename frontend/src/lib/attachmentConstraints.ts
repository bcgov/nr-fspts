/**
 * Constraints shared by every attachment-upload widget — FSP Attachments
 * tab (per-FSP attachment management) and the Data Submission screen
 * (attachments accompanying an XML/GeoJSON submission). Keep both
 * uploaders in lockstep by importing from this module rather than
 * redeclaring locally.
 *
 * The 50-byte filename cap matches the database column width
 * (FSP_ATTACHMENT.ATTACHMENT_NAME VARCHAR2(50), and the identically
 * named column on STANDARDS_REGIME_ATTACHMENT); over that, the insert
 * blows up mid-upload with ORA-12899.
 *
 * The cap is measured in UTF-8 BYTES, not characters. Oracle VARCHAR2
 * lengths are byte-semantic by default — a char-semantic column would
 * read VARCHAR2(50 CHAR) — so counting `name.length` (UTF-16 code
 * units) let a 50-"character" name occupy 52 bytes, pass this check,
 * and then fail the insert. An en-dash (U+2013) costs 3 bytes and is
 * what Word and Outlook autocorrect produce from a typed hyphen;
 * accented letters cost 2. Keep this in step with the server-side
 * ca.bc.gov.nrs.fsp.api.util.AttachmentConstraints.
 */

/** Allow-list of file extensions, lowercase with leading dot. */
export const ACCEPTED_ATTACHMENT_EXTENSIONS: readonly string[] = [
  '.pdf',
  '.doc',
  '.docx',
];

/** Max filename length in UTF-8 bytes, including the extension. Matches DB column. */
export const MAX_ATTACHMENT_FILENAME_LEN = 50;

/**
 * UTF-8 byte length of a filename — the value the DB column actually
 * bounds. Differs from `name.length` for any non-ASCII character.
 */
export const filenameByteLength = (filename: string): number =>
  new TextEncoder().encode(filename).length;

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
  const nameBytes = filenameByteLength(file.name);
  if (nameBytes > MAX_ATTACHMENT_FILENAME_LEN) {
    // Report the byte count as the count that matters, but only mention
    // the multi-byte rule when it is actually what tipped the file over —
    // otherwise a plainly-too-long ASCII name gets a confusing hint.
    const inflated = nameBytes > file.name.length;
    return {
      title: 'File name too long',
      subtitle:
        `Max ${MAX_ATTACHMENT_FILENAME_LEN} characters including the extension `
        + `(this file counts as ${nameBytes}`
        + (inflated
          ? `, because accented letters and long dashes count as 2-3 each`
          : '')
        + `). Rename and try again.`,
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
