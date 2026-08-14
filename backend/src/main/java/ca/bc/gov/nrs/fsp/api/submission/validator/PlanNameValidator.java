package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ActionCodeType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.validation.FspFieldRules;
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
 *
 * <p>Length is checked for every action code, not just Initial: whenever a
 * submission supplies a planName it is written to
 * {@code FOREST_STEWARDSHIP_PLAN.PLAN_NAME VARCHAR2(120)}, and nothing
 * between the parser and the proc bounds it — an over-long value surfaced as
 * a raw {@code ORA-12899} 500 at persist time instead of a validation issue.
 */
@Component
@Slf4j
public class PlanNameValidator {

  /** {@code FOREST_STEWARDSHIP_PLAN.PLAN_NAME}. */
  private static final int MAX_PLAN_NAME_LEN = FspFieldRules.MAX_PLAN_NAME_LEN;

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
    String name = plan.getPlanName();
    if (name == null || name.isBlank()) {
      // Only Initial has nothing to carry forward, so only Initial fails here.
      if (plan.getActionCode() == ActionCodeType.I) {
        errors.add(SubmissionValidationError.of(
            "forestStewardshipPlan/planName",
            "PLAN_NAME_REQUIRED",
            "Initial submissions must include a planName."));
      }
      return errors;
    }
    if (name.trim().length() > MAX_PLAN_NAME_LEN) {
      errors.add(SubmissionValidationError.of(
          "forestStewardshipPlan/planName",
          "PLAN_NAME_TOO_LONG",
          "planName must be " + MAX_PLAN_NAME_LEN + " characters or fewer (got "
              + name.trim().length() + ")."));
    }
    return errors;
  }
}
