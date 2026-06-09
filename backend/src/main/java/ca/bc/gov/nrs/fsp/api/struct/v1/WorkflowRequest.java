package ca.bc.gov.nrs.fsp.api.struct.v1;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;

/**
 * Subset of FSP_700_WORKFLOW.MAINLINE inputs needed to submit a workflow
 * action. The full proc has 70 INOUT params — only the fields actually
 * used by the per-action dispatch in WorkflowService are exposed here.
 * Each field is optional unless the action that's being submitted needs
 * it (e.g. SAVE_REVIEW needs milestoneType + completed; SAVE_OTBH_*
 * needs otbhDate; SAVE_DDM_* needs decisionDate/effectiveDate/etc.).
 */
@Data
@SuperBuilder
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode(callSuper = true)
public class WorkflowRequest extends BaseRequest {

  /** P_ACTION — e.g. "SAVE_REVIEW", "SAVE_OTBH_OFFERED", "SAVE_DDM_APP". */
  @NotBlank(message = "Action is required")
  @Size(max = 20)
  private String action;

  /** Amendment scope. Required by every SAVE_* dispatch. */
  @Size(max = 10)
  private String fspAmendmentNumber;

  /** P_FSP_REVIEW_MILESTONE_TYP_CD — required for SAVE_REVIEW. FNR/RS/ORS/DDM/OTHER. */
  @Size(max = 5)
  private String milestoneType;

  /** P_COMPLETED_IND — "Y" / "N". Required by SAVE_REVIEW + SAVE_OTBH_*. */
  @Size(max = 1)
  private String completed;

  /**
   * P_OTBH_DATE — required for SAVE_OTBH_OFFERED, optional for
   * SAVE_OTBH_HEARD. Plain date string in {@code YYYY-MM-DD};
   * the proc routes it through {@code fsp_common.convert_to_date}.
   * Must not be a future date — the proc rejects with FSP.BAD.OTBH.DATE.
   */
  @Size(max = 10)
  private String otbhDate;

  /**
   * P_FSP_STATUS_CODE — the CURRENT status of the FSP/amendment, echoed
   * back on SAVE_DDM_* / SAVE_EXT_* so the proc can decide its undo /
   * re-save branch. Sourced from {@link WorkflowState#fspStatusCode}.
   */
  @Size(max = 3)
  private String fspStatusCode;

  /**
   * P_FSP_AMENDMENT_CODE — the amendment code (Original / Amendment /
   * Replacement / Extension etc.). Required by SAVE_DDM_APP so
   * {@code fsp_common_db.fsp_approval} routes the right approval path.
   */
  @Size(max = 3)
  private String fspAmendmentCode;

  /** P_SUBMISSION_DATE — Submission Date for the decision (YYYY-MM-DD). */
  @Size(max = 10)
  private String submissionDate;

  /** P_DECISION_DATE — Decision Date for the decision (YYYY-MM-DD). */
  @Size(max = 10)
  private String decisionDate;

  /**
   * P_PLAN_START_DATE — Effective Date for the decision (YYYY-MM-DD).
   * Required for SAVE_DDM_APP and SAVE_EXT_APP (the "Approve"
   * branches). Named {@code effectiveDate} on the wire to match what
   * the user sees in the dialog.
   */
  @Size(max = 10)
  private String effectiveDate;

  /**
   * P_EXTENSION_ID — the extension request being decided. Required by
   * SAVE_EXT_APP / SAVE_EXT_REJ; ignored by other actions.
   */
  @Size(max = 20)
  private String extensionId;

  /** P_REVIEW_COMMENT. */
  @Size(max = 4000)
  private String comments;
}
