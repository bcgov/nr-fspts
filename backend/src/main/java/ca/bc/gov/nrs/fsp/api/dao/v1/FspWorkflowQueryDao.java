package ca.bc.gov.nrs.fsp.api.dao.v1;

/**
 * Lightweight, read-only lookups that back the Workflow tab's decision
 * projection where {@code FSP_700_WORKFLOW.MAINLINE(GET)} can't. Its
 * {@code get_ddm_only} only returns a decision when the amendment's CURRENT
 * status still matches the decision status — so once a newer amendment is
 * approved and the prior one is retired (RET), the proc stops surfacing the
 * approval that was recorded on that earlier version. This DAO reads the
 * recorded decision straight from {@code fsp_status_history} regardless of
 * the amendment's current status, so viewing a superseded/retired version
 * still shows what was decided on it.
 */
public interface FspWorkflowQueryDao {

  /**
   * The DDM determination recorded on a specific FSP amendment — the latest
   * Approved / In-Effect / Rejected status-history row for that version,
   * plus the plan-level dates. Dates are formatted {@code YYYY-MM-DD} to
   * match {@code fsp_common.convert_to_char} (the proc's format).
   */
  record RecordedDecision(
      String statusCode,
      String name,
      String submissionDate,
      String decisionDate,
      String effectiveDate,
      String comment) {}

  /**
   * @return the recorded decision for {@code (fspId, amendmentNumber)}, or
   *     {@code null} when the version has no Approved/In-Effect/Rejected
   *     history row (e.g. a still-draft amendment).
   */
  RecordedDecision findRecordedDecision(long fspId, long amendmentNumber);

  /**
   * The {@code amendment_approval_date} recorded on a specific FSP amendment.
   * FSP_700_WORKFLOW.MAINLINE(GET) doesn't surface this column, so the
   * Workflow tab's DDM Decision tile reads it straight from
   * {@code forest_stewardship_plan}. Formatted {@code YYYY-MM-DD} to match
   * {@code fsp_common.convert_to_char} (the proc's date format).
   *
   * @return the formatted approval date, or {@code null} when the column is
   *     empty (unapproved / original plan) or the row doesn't exist.
   */
  String findAmendmentApprovalDate(long fspId, long amendmentNumber);
}
