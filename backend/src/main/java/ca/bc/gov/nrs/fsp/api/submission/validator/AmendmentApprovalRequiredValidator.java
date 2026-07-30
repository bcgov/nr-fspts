package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ActionCodeType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import jakarta.xml.bind.JAXBElement;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Mirrors the Amend modal's "approval required" rule for XML submissions:
 * when an Amendment (actionCode {@code A}) declares an FDU-boundary and/or
 * stocking-standard change, it must also require district approval.
 *
 * <p>Only {@code A} is checked:
 * <ul>
 *   <li>Replacement ({@code R}) is <b>always</b> forced approval-required by
 *       {@code SubmissionPersistenceService} (FRPA/legacy parity), so the
 *       flag isn't a submitter choice there — validating it would just reject
 *       a value we override.</li>
 *   <li>Initial ({@code I}) and Update ({@code U}) ignore the amendment-
 *       metadata fields entirely, so validating them would flag a value we
 *       never apply.</li>
 * </ul>
 */
@Component
@Slf4j
public class AmendmentApprovalRequiredValidator {

  private static final String PATH =
      "forestStewardshipPlan/amendmentApprovalRequiredInd";
  private static final String CODE = "AMENDMENT_APPROVAL_REQUIRED";

  public List<SubmissionValidationError> validate(FSPSubmissionType submission) {
    List<SubmissionValidationError> errors = new ArrayList<>();
    if (submission == null || submission.getSubmissionItem() == null) {
      return errors;
    }
    ForestStewardshipPlanType plan =
        submission.getSubmissionItem().getForestStewardshipPlan();
    if (plan == null) {
      return errors;
    }
    // Amendment only — Replacement forces approval-required, Initial/Update
    // ignore the amendment fields (see class javadoc).
    if (plan.getActionCode() != ActionCodeType.A) {
      return errors;
    }

    boolean fduChanged = Boolean.TRUE.equals(plan.isFduUpdateInd());
    boolean stockingChanged = Boolean.TRUE.equals(plan.isStockingStandardUpdateInd());
    if (!fduChanged && !stockingChanged) {
      return errors;
    }

    JAXBElement<Boolean> approvalEl = plan.getAmendmentApprovalRequiredInd();
    boolean approvalRequired =
        approvalEl != null && Boolean.TRUE.equals(approvalEl.getValue());
    if (!approvalRequired) {
      errors.add(SubmissionValidationError.of(PATH, CODE, message(fduChanged, stockingChanged)));
    }
    return errors;
  }

  private static String message(boolean fduChanged, boolean stockingChanged) {
    String changes;
    if (fduChanged && stockingChanged) {
      changes = "FDU boundaries and stocking standards";
    } else if (fduChanged) {
      changes = "FDU boundaries";
    } else {
      changes = "stocking standards";
    }
    return "Because this amendment changes " + changes
        + ", it must require district approval. Set amendmentApprovalRequiredInd"
        + " to true in the submission.";
  }
}
