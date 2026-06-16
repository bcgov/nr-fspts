package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ActionCodeType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * {@code <planName>} is XSD-optional (carried forward from a prior
 * amendment on AMD/RPL) but the proc raises {@code FSP.NO.NAME} when
 * an Initial submission (I) lands without one — there's nothing to
 * carry forward in that case. Caught here so the submitter doesn't
 * have to round-trip the proc to learn that.
 */
@Component
@Slf4j
public class PlanNameValidator {

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
    if (plan.getActionCode() != ActionCodeType.I) {
      return errors;
    }
    String name = plan.getPlanName();
    if (name == null || name.isBlank()) {
      errors.add(SubmissionValidationError.of(
          "forestStewardshipPlan/planName",
          "PLAN_NAME_REQUIRED",
          "Initial submissions must include a planName."));
    }
    return errors;
  }
}
