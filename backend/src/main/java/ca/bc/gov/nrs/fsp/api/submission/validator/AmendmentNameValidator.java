package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import jakarta.xml.bind.JAXBElement;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * {@code <licenseeAmendmentName>} (GeoJSON {@code fsp.amendmentName}) is
 * optional, but when supplied it lands in
 * {@code FOREST_STEWARDSHIP_PLAN.LICENSEE_AMENDMENT_NAME VARCHAR2(30)} — the
 * tightest free-text column on the header, and short enough that an ordinary
 * descriptive name ("Road deactivation and stocking standards update" is 47)
 * overflows it. Nothing between the parser and the proc bounded it, so an
 * over-long value came back as a raw {@code ORA-12899} 500 at persist time
 * rather than as a validation issue the submitter could act on.
 */
@Component
@Slf4j
public class AmendmentNameValidator {

  /** {@code FOREST_STEWARDSHIP_PLAN.LICENSEE_AMENDMENT_NAME}. */
  private static final int MAX_AMENDMENT_NAME_LEN = 30;

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
    // The XSD makes this element nillable, so JAXB hands back a wrapper
    // rather than the String itself.
    JAXBElement<String> element = plan.getLicenseeAmendmentName();
    String name = element == null ? null : element.getValue();
    if (name == null || name.isBlank()) {
      return errors;
    }
    if (name.trim().length() > MAX_AMENDMENT_NAME_LEN) {
      errors.add(SubmissionValidationError.of(
          "forestStewardshipPlan/licenseeAmendmentName",
          "AMENDMENT_NAME_TOO_LONG",
          "amendmentName must be " + MAX_AMENDMENT_NAME_LEN
              + " characters or fewer (got " + name.trim().length() + ")."));
    }
    return errors;
  }
}
