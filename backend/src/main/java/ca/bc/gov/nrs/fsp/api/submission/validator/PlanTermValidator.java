package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Plan-term mutual-exclusion check.
 *
 * <p>The XSD lets {@code planTermYears}, {@code planTermMonths} and
 * {@code planTermExpiry} all coexist (they're independent
 * {@code minOccurs="0"} elements), but the proc enforces a business
 * XOR — see {@code FSP.BOTH.PLAN.TERM_OR_END_DATE} raised inside
 * {@code fsp_300_information.MAINLINE}. Surface the violation here so
 * the submitter sees it on upload instead of after the REPLACE / AMEND
 * row has already been written.
 *
 * <p>The element docstring captures the rule: <em>"Cannot occur if
 * planTermExpiry is present"</em> (planTermMonths) and <em>"If
 * planTermYears is present, cannot submit planTermExpiry"</em>
 * (planTermExpiry). Equivalent statement: term (years and/or months)
 * is mutually exclusive with expiry.
 */
@Component
@Slf4j
public class PlanTermValidator {

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

    boolean hasTerm = plan.getPlanTermYears() != null || plan.getPlanTermMonths() != null;
    boolean hasExpiry = plan.getPlanTermExpiry() != null;

    if (hasTerm && hasExpiry) {
      errors.add(SubmissionValidationError.of(
          "forestStewardshipPlan/planTermExpiry",
          "PLAN_TERM_OR_EXPIRY_EXCLUSIVE",
          "Provide either a plan term (years and/or months) or a plan"
              + " expiry date, not both — the proc rejects submissions"
              + " that carry both."));
    }
    return errors;
  }
}
