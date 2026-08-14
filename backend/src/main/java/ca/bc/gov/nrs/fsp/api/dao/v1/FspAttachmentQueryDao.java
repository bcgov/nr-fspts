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

  /**
   * True when the given {@code (fspId, amendmentNumber)} has at least one
   * {@code FOREST_DEVELOPMENT_UNIT} row.
   *
   * <p>Counts header rows, which is the same thing the FDU/Map tab lists.
   * Amendment creation copies FDUs forward ({@code fsp_common_db.fdu_copy}),
   * so every amendment carries its own rows and a plain count on this
   * amendment is the right question — no need to look back at the original.
   *
   * <p>Deliberately NOT {@code has_new_fdu_spatial}: that function answers
   * "were FDUs created on this amendment" (it compares entry/update
   * timestamps) and returns false for FDUs merely carried forward, which is
   * a perfectly valid plan. This asks the weaker question the rule needs —
   * does the plan have any FDU at all.
   */
  boolean hasFdu(long fspId, long amendmentNumber);
}
