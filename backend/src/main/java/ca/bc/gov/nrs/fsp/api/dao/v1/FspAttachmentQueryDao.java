package ca.bc.gov.nrs.fsp.api.dao.v1;

/**
 * Lightweight, read-only attachment existence checks used by the
 * app-level submit validation. Distinct from {@link Fsp400AttachmentsDao}
 * (which wraps the full FSP_400_ATTACHMENTS package) — these are direct
 * table queries against {@code fsp_attachment_xref}/{@code fsp_attachment}
 * so a Submit preflight/guard can answer "is the required document on this
 * exact amendment?" without pulling every attachment cursor.
 */
public interface FspAttachmentQueryDao {

  /**
   * True when at least one FSP Legal Document (attachment type code
   * {@code 'FSP'}) is linked to the given {@code (fspId, amendmentNumber)}
   * via {@code fsp_attachment_xref}.
   *
   * <p>Mirrors the exact existence check {@code fsp_common_validation}
   * runs — but only in its APP/INE branch. The Draft→Submitted branch
   * skips it ("no need to check legal document at this moment"), so we
   * enforce it here at submit time instead.
   */
  boolean hasLegalDocument(long fspId, long amendmentNumber);
}
