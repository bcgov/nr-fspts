package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionItemAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ObjectFactory;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link AmendmentNameValidator} —
 * {@code FOREST_STEWARDSHIP_PLAN.LICENSEE_AMENDMENT_NAME VARCHAR2(30)}, the
 * tightest free-text column on the header.
 *
 * <p>Two traps are covered here. First, 30 characters is short enough that an
 * ordinary descriptive amendment name overflows it, so this rule fires on
 * realistic input rather than only on pathological input. Second, JAXB exposes
 * this element as a {@code JAXBElement<String>} wrapper rather than a plain
 * String (unlike {@code planName} right beside it) — reading it without
 * unwrapping would measure the wrapper's {@code toString()} and silently never
 * fire.
 */
class AmendmentNameValidatorTest {

  private static final ObjectFactory OF = new ObjectFactory();

  private final AmendmentNameValidator validator = new AmendmentNameValidator();

  @Test
  void atMaxLength_isAccepted() {
    assertThat(validator.validate(submission("x".repeat(30)))).isEmpty();
  }

  @Test
  void overMaxLength_isRejected() {
    List<SubmissionValidationError> errors = validator.validate(submission("x".repeat(31)));
    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).code()).isEqualTo("AMENDMENT_NAME_TOO_LONG");
    assertThat(errors.get(0).message()).contains("30").contains("31");
    assertThat(errors.get(0).path())
        .isEqualTo("forestStewardshipPlan/licenseeAmendmentName");
  }

  @Test
  void realisticDescriptiveName_isRejected() {
    // 47 characters — the kind of name a licensee actually types, and the
    // reason this rule earns its keep rather than being a theoretical bound.
    String name = "Road deactivation and stocking standards update";
    assertThat(name).hasSize(47);
    assertThat(codes(validator.validate(submission(name))))
        .containsExactly("AMENDMENT_NAME_TOO_LONG");
  }

  @Test
  void absentAmendmentName_isAccepted() {
    // Optional field: a submission that omits it entirely is fine.
    assertThat(validator.validate(submission(null))).isEmpty();
  }

  @Test
  void nilJaxbElement_isAccepted() {
    // xsi:nil="true" produces a present wrapper holding a null value.
    ForestStewardshipPlanType plan = new ForestStewardshipPlanType();
    plan.setLicenseeAmendmentName(
        OF.createForestStewardshipPlanTypeLicenseeAmendmentName(null));
    assertThat(validator.validate(wrap(plan))).isEmpty();
  }

  @Test
  void blankAmendmentName_isAccepted() {
    assertThat(validator.validate(submission("   "))).isEmpty();
  }

  @Test
  void whitespacePaddedNameWithinLimit_isAccepted() {
    assertThat(validator.validate(submission("  " + "x".repeat(30) + "  "))).isEmpty();
  }

  @Test
  void nullSubmissionOrPlan_isAccepted() {
    assertThat(validator.validate(null)).isEmpty();
    assertThat(validator.validate(new FSPSubmissionType())).isEmpty();
  }

  // ── helpers ──────────────────────────────────────────────────────

  private static List<String> codes(List<SubmissionValidationError> errors) {
    return errors.stream().map(SubmissionValidationError::code).toList();
  }

  private static FSPSubmissionType submission(String amendmentName) {
    ForestStewardshipPlanType plan = new ForestStewardshipPlanType();
    if (amendmentName != null) {
      plan.setLicenseeAmendmentName(
          OF.createForestStewardshipPlanTypeLicenseeAmendmentName(amendmentName));
    }
    return wrap(plan);
  }

  private static FSPSubmissionType wrap(ForestStewardshipPlanType plan) {
    FSPSubmissionItemAssociationType item = new FSPSubmissionItemAssociationType();
    item.setForestStewardshipPlan(plan);
    FSPSubmissionType submission = new FSPSubmissionType();
    submission.setSubmissionItem(item);
    return submission;
  }
}
