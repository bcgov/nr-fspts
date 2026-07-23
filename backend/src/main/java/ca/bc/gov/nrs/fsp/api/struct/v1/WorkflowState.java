package ca.bc.gov.nrs.fsp.api.struct.v1;

import java.util.List;

/**
 * Read-only projection of FSP_700_WORKFLOW.MAINLINE (P_ACTION='GET') for the
 * Workflow tab on the FSP Information page. The legacy screen (FSP700) packed
 * five review milestones, two OTBH dates, three DDM decisions, and an
 * extension decision onto a single dense form — this DTO groups them into the
 * four sections the proc actually populates so the front-end can hide the
 * empty ones.
 *
 * <p>Every field is a nullable String to mirror the proc's VARCHAR2 OUT
 * params; dates arrive pre-formatted via {@code fsp_common.convert_to_char}.
 */
public record WorkflowState(
    String fspId,
    String fspAmendmentNumber,
    String fspStatusCode,
    String fspStatusDesc,
    /**
     * P_FSP_AMENDMENT_CODE — surfaced so the DDM Decision dialog can
     * round-trip it on SAVE_DDM_APP (the proc needs the amendment code
     * to route the approval through fsp_approval correctly).
     */
    String fspAmendmentCode,
    /**
     * FSP-level expiry (plan_end_date-derived) — FSP_700 returns it via
     * P_FSP_EXPIRY_DATE. Surfaced so the DDM Decision tile can show the
     * Expiry date alongside the decision dates. Pre-formatted YYYY-MM-DD.
     */
    String fspExpiryDate,
    /**
     * forest_stewardship_plan.amendment_approval_date for the resolved
     * amendment — the DDM Decision tile shows it only for an approved
     * amendment. FSP_700 doesn't return it, so it's read app-side via a
     * direct query (FspWorkflowQueryDao.findAmendmentApprovalDate). Null
     * when this is the original plan or the amendment isn't approved.
     */
    String amendmentApprovalDate,
    List<ReviewItem> reviewItems,
    Otbh otbh,
    DdmDecision ddmDecision,
    ExtensionDecision extensionDecision,
    String extensionIds,
    /**
     * Effective FSPTS roles for the calling user, projected from the
     * JWT's cognito:groups. The Workflow tab uses these to gate the
     * per-section Edit buttons without re-implementing role-suffix
     * matching client-side.
     */
    Roles roles
) {

  public record Roles(
      boolean isReviewer,
      boolean isDecisionMaker,
      boolean isAdministrator
  ) {}

  /**
   * One row in the "Review Details" section. The legacy form rendered each
   * as a checkbox with a name/timestamp/comment block beside it; collapsed
   * here into a single record per milestone so the front-end can stack them
   * in one table.
   */
  public record ReviewItem(
      String code,
      String label,
      String completedInd,
      String entryUserId,
      String entryTimestamp,
      String comment
  ) {}

  /**
   * "Opportunity To Be Heard" offered + heard dates with their respective
   * comments. Both halves are optional; the proc populates whichever events
   * have fired on this FSP/amendment.
   */
  public record Otbh(
      String offeredDate,
      String offeredComment,
      String heardDate,
      String heardComment
  ) {}

  /**
   * The DDM decision block — the proc returns a single status code that
   * encodes which row of the legacy form is populated (APP/INE = approved,
   * REJ = rejected, DFT = request-for-clarification, blank = none). The
   * decision date / submission date / effective date / decision-maker name
   * / comment apply to whichever variant is active.
   */
  public record DdmDecision(
      String statusCode,
      String name,
      String submissionDate,
      String decisionDate,
      String effectiveDate,
      String comment
  ) {}

  /**
   * The first non-rejected extension request (by status priority: SUB > APP).
   * The proc surfaces decision metadata only for APP rows.
   */
  public record ExtensionDecision(
      String statusCode,
      String extensionId,
      String name,
      String submissionDate,
      String decisionDate,
      String effectiveDate,
      String comment
  ) {}
}
