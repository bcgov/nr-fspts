package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FDUAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FDUType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionItemAssociationType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.ForestStewardshipPlanType;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link FduNameValidator} — uniqueness (the proc raises
 * {@code FSP.DUPLICATE.FDU.NAME}) plus length against
 * {@code FOREST_DEVELOPMENT_UNIT.FDU_NAME VARCHAR2(120)}.
 *
 * <p>The duplicate cases are not incidental: a GIS export that splits a
 * multi-part FDU into one feature per polygon produces exactly that shape, so
 * this is the rule real submissions trip over. The length rule was added
 * alongside it, and {@code longAndDuplicated_reportsBoth} pins the fact that
 * adding length checking did not short-circuit the uniqueness pass.
 */
class FduNameValidatorTest {

  private final FduNameValidator validator = new FduNameValidator();

  // ── length ───────────────────────────────────────────────────────

  @Test
  void atMaxLength_isAccepted() {
    assertThat(validator.validate(submission("x".repeat(120)))).isEmpty();
  }

  @Test
  void overMaxLength_isRejected() {
    List<SubmissionValidationError> errors = validator.validate(submission("x".repeat(121)));
    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).code()).isEqualTo("FDU_NAME_TOO_LONG");
    assertThat(errors.get(0).message()).contains("120").contains("121");
    assertThat(errors.get(0).path()).isEqualTo("forestStewardshipPlan/fduList/fdu[0]/fduName");
  }

  @Test
  void overMaxLength_reportsTheOffendingIndex() {
    List<SubmissionValidationError> errors =
        validator.validate(submission("FDU-1", "FDU-2", "x".repeat(121)));
    assertThat(codes(errors)).containsExactly("FDU_NAME_TOO_LONG");
    assertThat(errors.get(0).path()).isEqualTo("forestStewardshipPlan/fduList/fdu[2]/fduName");
  }

  // ── uniqueness (pre-existing behaviour, pinned against regression) ──

  @Test
  void duplicateNames_areRejected() {
    List<SubmissionValidationError> errors = validator.validate(submission("FDU-1", "FDU-1"));
    assertThat(codes(errors)).containsExactly("DUPLICATE_FDU_NAME");
    assertThat(errors.get(0).message()).contains("FDU-1");
  }

  @Test
  void duplicateNamesDifferingOnlyByCaseOrSpace_areRejected() {
    // Matches the proc's NLS_UPPER-based dedup.
    assertThat(codes(validator.validate(submission("FDU-1", "  fdu-1  "))))
        .containsExactly("DUPLICATE_FDU_NAME");
  }

  @Test
  void distinctNames_areAccepted() {
    assertThat(validator.validate(submission("FDU-1", "FDU-2", "FDU-3"))).isEmpty();
  }

  // ── interaction ──────────────────────────────────────────────────

  @Test
  void longAndDuplicated_reportsBoth() {
    // A name can be both over-length and a duplicate; neither check may
    // swallow the other.
    String tooLong = "x".repeat(121);
    List<SubmissionValidationError> errors = validator.validate(submission(tooLong, tooLong));
    assertThat(codes(errors)).containsExactlyInAnyOrder(
        "FDU_NAME_TOO_LONG", "FDU_NAME_TOO_LONG", "DUPLICATE_FDU_NAME");
  }

  // ── edges ────────────────────────────────────────────────────────

  @Test
  void blankAndNullNames_areSkipped() {
    // Presence is enforced by the parser's shape check, not here.
    assertThat(validator.validate(submission(null, "   "))).isEmpty();
  }

  @Test
  void noFduList_isAccepted() {
    ForestStewardshipPlanType plan = new ForestStewardshipPlanType();
    FSPSubmissionItemAssociationType item = new FSPSubmissionItemAssociationType();
    item.setForestStewardshipPlan(plan);
    FSPSubmissionType submission = new FSPSubmissionType();
    submission.setSubmissionItem(item);
    assertThat(validator.validate(submission)).isEmpty();
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

  private static FSPSubmissionType submission(String... fduNames) {
    FDUAssociationType fduList = new FDUAssociationType();
    for (String name : fduNames) {
      FDUType fdu = new FDUType();
      fdu.setFduName(name);
      fduList.getFdu().add(fdu);
    }
    ForestStewardshipPlanType plan = new ForestStewardshipPlanType();
    plan.setFduList(fduList);
    FSPSubmissionItemAssociationType item = new FSPSubmissionItemAssociationType();
    item.setForestStewardshipPlan(plan);
    FSPSubmissionType submission = new FSPSubmissionType();
    submission.setSubmissionItem(item);
    return submission;
  }
}
