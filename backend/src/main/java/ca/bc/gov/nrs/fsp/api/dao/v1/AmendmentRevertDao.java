package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

/**
 * Reads and writes behind the Administrator "revert approval" action
 * ({@code AmendmentRevertService}). The status change itself goes through
 * the granted {@code fsp_common_db.fsp_status_update} so a
 * {@code FSP_STATUS_HISTORY} row is written — the proxy user has no direct
 * INSERT on that table (ORA-942). Everything else is a direct read or a
 * narrow UPDATE on columns the proxy user can already write.
 */
public interface AmendmentRevertDao {

  /** Header columns the revert guards and the date clean-up need. */
  record AmendmentRow(
      String statusCode,
      String amendmentCode,
      Timestamp amendmentSubmissionDate) {}

  /** A non-default standard linked to the amendment, with its current status. */
  record LinkedStandard(long regimeId, String name, String statusCode) {}

  /** One error accumulated by the proc via {@code fsp_error.set_error}. */
  record ProcError(String code, String procMessage) {}

  Optional<AmendmentRow> findAmendment(long fspId, long amendmentNumber);

  /**
   * Amendments numbered above {@code amendmentNumber} that are still live
   * (Draft, Submitted, Opportunity to be Heard, Approved or In Effect).
   * Deleted, cancelled, retired and rejected ones don't count.
   */
  int countLaterLiveAmendments(long fspId, long amendmentNumber);

  /** Approved or submitted extensions attached to this amendment. */
  int countExtensionsOnAmendment(long fspId, long amendmentNumber);

  /**
   * Non-default standards linked to the amendment — the same set
   * {@code fsp_status_update}'s {@code standards_regime_cur} re-stamps
   * with the new FSP status.
   */
  List<LinkedStandard> findNonDefaultStandards(long fspId, long amendmentNumber);

  void setStandardStatus(long regimeId, String statusCode);

  /**
   * Calls {@code fsp_common_db.fsp_status_update} and returns whatever it
   * accumulated in {@code fsp_error} — the proc reports failures (invalid
   * transition, {@code validate_fsp} errors) that way rather than raising.
   * Empty list ⇒ the status changed and the history row was written.
   */
  List<ProcError> updateStatus(
      long fspId, long amendmentNumber, String statusCode, String comment, String userId);

  /** Id of the newest {@code FSP_STATUS_HISTORY} row in the given status, or null. */
  Long findLatestHistoryId(long fspId, long amendmentNumber, String statusCode);

  /**
   * Clears the approval fields (approval date, approving authority,
   * decision date/user) and sets {@code amendment_submission_date} to
   * {@code submissionDate} — null when going back to Draft, the
   * pre-revert value when going back to Submitted (the status proc
   * re-stamps it with today's date on any move to SUB).
   */
  int clearApprovalFields(
      long fspId, long amendmentNumber, Timestamp submissionDate, String userId);
}
