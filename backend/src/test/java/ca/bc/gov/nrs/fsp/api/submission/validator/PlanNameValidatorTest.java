package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ActionCodeType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionItemAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link PlanNameValidator} — presence (Initial only) plus
 * length against {@code FOREST_STEWARDSHIP_PLAN.PLAN_NAME VARCHAR2(120)}.
 *
 * <p>The two halves have deliberately different scopes, which is the easiest
 * thing to get wrong here: presence applies only to Initial (an amendment
 * carries the name forward from the prior version), but length applies to
 * every action code, because any supplied name is written. The
 * {@code overMaxLength_onAmendment_isRejected} case guards exactly that — an
 * early return for non-Initial submissions would make the length rule dead
 * code for the amendment path.
 */
class PlanNameValidatorTest {

  private final PlanNameValidator validator = new PlanNameValidator();

  @Test
  void missingNameOnInitial_isRejected() {
    List<SubmissionValidationError> errors = validator.validate(submission(null, ActionCodeType.I));
    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).code()).isEqualTo("PLAN_NAME_REQUIRED");
  }

  @Test
  void blankNameOnInitial_isRejected() {
    assertThat(codes(validator.validate(submission("   ", ActionCodeType.I))))
        .containsExactly("PLAN_NAME_REQUIRED");
  }

  @Test
  void missingNameOnAmendment_isAccepted() {
    // Carried forward from the prior amendment — nothing to complain about.
    assertThat(validator.validate(submission(null, ActionCodeType.A))).isEmpty();
  }

  @Test
  void atMaxLength_isAccepted() {
    assertThat(validator.validate(submission("x".repeat(120), ActionCodeType.I))).isEmpty();
  }

  @Test
  void overMaxLength_isRejected() {
    List<SubmissionValidationError> errors =
        validator.validate(submission("x".repeat(121), ActionCodeType.I));
    assertThat(codes(errors)).containsExactly("PLAN_NAME_TOO_LONG");
    assertThat(errors.get(0).message()).contains("120").contains("121");
  }

  @Test
  void overMaxLength_onAmendment_isRejected() {
    // Length is NOT Initial-only: an amendment that supplies an over-long
    // name writes it just the same, so the rule has to fire here too.
    assertThat(codes(validator.validate(submission("x".repeat(121), ActionCodeType.A))))
        .containsExactly("PLAN_NAME_TOO_LONG");
  }

  @Test
  void overMaxLength_onUpdateAndReplacement_isRejected() {
    assertThat(codes(validator.validate(submission("x".repeat(121), ActionCodeType.U))))
        .containsExactly("PLAN_NAME_TOO_LONG");
    assertThat(codes(validator.validate(submission("x".repeat(121), ActionCodeType.R))))
        .containsExactly("PLAN_NAME_TOO_LONG");
  }

  @Test
  void whitespacePaddedNameWithinLimit_isAccepted() {
    // Trimmed before measuring — the proc stores the trimmed value.
    assertThat(validator.validate(submission("  " + "x".repeat(120) + "  ", ActionCodeType.I)))
        .isEmpty();
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

  private static FSPSubmissionType submission(String planName, ActionCodeType action) {
    ForestStewardshipPlanType plan = new ForestStewardshipPlanType();
    plan.setPlanName(planName);
    plan.setActionCode(action);
    FSPSubmissionItemAssociationType item = new FSPSubmissionItemAssociationType();
    item.setForestStewardshipPlan(plan);
    FSPSubmissionType submission = new FSPSubmissionType();
    submission.setSubmissionItem(item);
    return submission;
  }
}
