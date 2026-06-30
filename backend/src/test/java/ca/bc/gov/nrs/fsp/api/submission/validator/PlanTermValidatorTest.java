package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionItemAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import org.junit.jupiter.api.Test;

import javax.xml.datatype.DatatypeFactory;
import javax.xml.datatype.XMLGregorianCalendar;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link PlanTermValidator} — the proc's term-or-end-date rule
 * has two halves (not-both AND at-least-one), surfaced at validate time so the
 * submitter sees them on upload rather than at persist.
 */
class PlanTermValidatorTest {

  private final PlanTermValidator validator = new PlanTermValidator();

  @Test
  void neitherTermNorEndDate_isRejected() {
    List<SubmissionValidationError> errors = validator.validate(submission(null, null, null));
    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).code()).isEqualTo("PLAN_TERM_OR_END_DATE_REQUIRED");
    assertThat(errors.get(0).message())
        .isEqualTo("Enter either a plan term (years/months) or a plan end date.");
  }

  @Test
  void bothTermAndEndDate_isRejected() {
    List<SubmissionValidationError> errors = validator.validate(submission(5, null, date()));
    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).code()).isEqualTo("PLAN_TERM_OR_EXPIRY_EXCLUSIVE");
  }

  @Test
  void onlyTermYears_isAccepted() {
    assertThat(validator.validate(submission(5, null, null))).isEmpty();
  }

  @Test
  void onlyTermMonths_isAccepted() {
    assertThat(validator.validate(submission(null, 6, null))).isEmpty();
  }

  @Test
  void onlyEndDate_isAccepted() {
    assertThat(validator.validate(submission(null, null, date()))).isEmpty();
  }

  @Test
  void nullSubmissionOrPlan_isAccepted() {
    assertThat(validator.validate(null)).isEmpty();
    assertThat(validator.validate(new FSPSubmissionType())).isEmpty();
  }

  // ── helpers ──────────────────────────────────────────────────────

  private static FSPSubmissionType submission(
      Integer years, Integer months, XMLGregorianCalendar expiry) {
    ForestStewardshipPlanType plan = new ForestStewardshipPlanType();
    plan.setPlanTermYears(years);
    plan.setPlanTermMonths(months);
    plan.setPlanTermExpiry(expiry);
    FSPSubmissionItemAssociationType item = new FSPSubmissionItemAssociationType();
    item.setForestStewardshipPlan(plan);
    FSPSubmissionType submission = new FSPSubmissionType();
    submission.setSubmissionItem(item);
    return submission;
  }

  private static XMLGregorianCalendar date() {
    try {
      return DatatypeFactory.newInstance().newXMLGregorianCalendar("2030-01-01");
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}
