package ca.bc.gov.nrs.fsp.api.util;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;

/**
 * Server-side attachment upload constraints, shared by every upload path
 * (FSP attachments, standards-regime attachments, extension supporting
 * documents). Mirrors the frontend {@code @/lib/attachmentConstraints};
 * both sides must agree or the SPA will accept files the API rejects.
 *
 * <p><b>Filename length is measured in UTF-8 BYTES, not characters.</b>
 * The destination columns — {@code FSP_ATTACHMENT.ATTACHMENT_NAME} and
 * {@code STANDARDS_REGIME_ATTACHMENT.ATTACHMENT_NAME} — are both
 * {@code VARCHAR2(50)} with byte semantics (Oracle's default; a
 * char-semantic column would read {@code VARCHAR2(50 CHAR)}). Counting
 * characters instead let a 50-character name occupy 52 bytes and fail the
 * insert with ORA-12899 <em>after</em> passing validation. That is not
 * hypothetical: an en-dash (U+2013, 3 bytes in UTF-8) is what Word and
 * Outlook autocorrect produce from a typed hyphen, and accented letters
 * cost 2 bytes each.
 *
 * <p>UTF-8 is assumed because the Oracle instance is AL32UTF8. On a
 * single-byte database charset this over-counts slightly, which is the
 * safe direction — it rejects early rather than failing at the insert.
 */
public final class AttachmentConstraints {

  private AttachmentConstraints() {}

  /** Max filename length in UTF-8 bytes, matching ATTACHMENT_NAME VARCHAR2(50). */
  public static final int MAX_FILENAME_BYTES = 50;

  /** Per-file upload cap, in bytes (50 MB). */
  public static final long MAX_ATTACHMENT_BYTES = 50L * 1024 * 1024;

  /** Allow-list of file extensions, lowercase with leading dot. */
  public static final List<String> ACCEPTED_EXTENSIONS = List.of(".pdf", ".doc", ".docx");

  /** UTF-8 byte length of a filename — the value the DB column actually bounds. */
  public static int filenameByteLength(String fileName) {
    return fileName == null ? 0 : fileName.getBytes(StandardCharsets.UTF_8).length;
  }

  /**
   * Validate one upload against extension, filename length, then size —
   * the same order as the frontend so the messages line up. Throws
   * {@link IllegalArgumentException} (mapped to a 400 with a clean
   * message) on the first violation.
   */
  public static void validate(String fileName, long size) {
    String name = fileName == null ? "" : fileName;
    String lower = name.toLowerCase(Locale.ROOT);

    if (ACCEPTED_EXTENSIONS.stream().noneMatch(lower::endsWith)) {
      throw new IllegalArgumentException(
          "File type not supported. Upload a .pdf, .doc, or .docx file.");
    }

    int bytes = filenameByteLength(name);
    if (bytes > MAX_FILENAME_BYTES) {
      // Report the character count (what the user sees) alongside the
      // limit. A name that is visibly "short enough" but still rejected
      // is otherwise baffling — see the note above on en-dashes.
      throw new IllegalArgumentException(
          "File name too long. Use " + MAX_FILENAME_BYTES
              + " characters or fewer, including the extension. Accented letters "
              + "and long dashes count as 2-3 characters each, so this name "
              + "(" + name.length() + " characters) counts as " + bytes + ".");
    }

    if (size > MAX_ATTACHMENT_BYTES) {
      throw new IllegalArgumentException(
          "File exceeds size limit. Max file size is 50 MB. "
              + "Select a smaller file and try again.");
    }
  }
}
