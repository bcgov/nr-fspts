package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionMetadataType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ContactDetailsValidator}.
 *
 * <p>The contact fields map onto {@code CONTACT_NAME VARCHAR2(120)},
 * {@code TELEPHONE_NUMBER VARCHAR2(10)} and {@code EMAIL_ADDRESS VARCHAR2(120)}.
 * Before these rules existed an over-long value reached the proc and came back
 * as a raw {@code ORA-12899} 500 — a real submission failed on
 * {@code "250-720-6237"}, which is 12 characters once the dashes are counted.
 * The boundary cases below (exactly max vs max + 1) are the ones that matter:
 * an off-by-one here reopens that hole or rejects legitimate submissions.
 */
class ContactDetailsValidatorTest {

  private final ContactDetailsValidator validator = new ContactDetailsValidator();

  // ── telephone ────────────────────────────────────────────────────

  @Test
  void dashFormattedPhone_isRejected() {
    List<SubmissionValidationError> errors =
        validator.validate(submission("Jane Forester", "250-720-6237", "j@example.com"));
    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).code()).isEqualTo("CONTACT_PHONE_INVALID");
    // The offending value is quoted back so the submitter can find it.
    assertThat(errors.get(0).message()).contains("250-720-6237");
  }

  @Test
  void tenBareDigits_isAccepted() {
    assertThat(validator.validate(submission("Jane Forester", "2507206237", "j@example.com")))
        .isEmpty();
  }

  @Test
  void phoneWithSurroundingWhitespace_isAccepted() {
    assertThat(validator.validate(submission("Jane Forester", "  2507206237  ", "j@example.com")))
        .isEmpty();
  }

  @Test
  void nineDigitPhone_isRejected() {
    assertThat(codes(validator.validate(submission("Jane", "250720623", "j@example.com"))))
        .containsExactly("CONTACT_PHONE_INVALID");
  }

  @Test
  void elevenDigitPhone_isRejected() {
    assertThat(codes(validator.validate(submission("Jane", "12507206237", "j@example.com"))))
        .containsExactly("CONTACT_PHONE_INVALID");
  }

  @Test
  void bracketedPhone_isRejected() {
    assertThat(codes(validator.validate(submission("Jane", "(250) 720-6237", "j@example.com"))))
        .containsExactly("CONTACT_PHONE_INVALID");
  }

  @Test
  void blankPhone_reportsRequiredNotInvalid() {
    assertThat(codes(validator.validate(submission("Jane", "  ", "j@example.com"))))
        .containsExactly("CONTACT_PHONE_REQUIRED");
  }

  // ── contact name ─────────────────────────────────────────────────

  @Test
  void contactNameAtMaxLength_isAccepted() {
    assertThat(validator.validate(submission("x".repeat(120), "2507206237", "j@example.com")))
        .isEmpty();
  }

  @Test
  void contactNameOverMaxLength_isRejected() {
    List<SubmissionValidationError> errors =
        validator.validate(submission("x".repeat(121), "2507206237", "j@example.com"));
    assertThat(codes(errors)).containsExactly("CONTACT_NAME_TOO_LONG");
    assertThat(errors.get(0).message()).contains("120").contains("121");
  }

  // ── email ────────────────────────────────────────────────────────

  @Test
  void emailAtMaxLength_isAccepted() {
    String email = "a".repeat(111) + "@test.com"; // exactly 120
    assertThat(email).hasSize(120);
    assertThat(validator.validate(submission("Jane", "2507206237", email))).isEmpty();
  }

  @Test
  void emailOverMaxLength_isRejected() {
    String email = "a".repeat(112) + "@test.com"; // exactly 121
    assertThat(email).hasSize(121);
    assertThat(codes(validator.validate(submission("Jane", "2507206237", email))))
        .containsExactly("CONTACT_EMAIL_TOO_LONG");
  }

  // ── combinations / edges ─────────────────────────────────────────

  @Test
  void everyFieldBad_reportsAllThreeTogether() {
    // All problems surface in one pass — the submitter shouldn't have to
    // fix one field, re-upload, and discover the next.
    List<SubmissionValidationError> errors =
        validator.validate(submission("x".repeat(121), "250-720-6237", "a".repeat(121)));
    assertThat(codes(errors)).containsExactlyInAnyOrder(
        "CONTACT_NAME_TOO_LONG", "CONTACT_PHONE_INVALID", "CONTACT_EMAIL_TOO_LONG");
  }

  @Test
  void missingMetadata_reportsAllThreeAsRequired() {
    FSPSubmissionType submission = new FSPSubmissionType();
    assertThat(codes(validator.validate(submission))).containsExactlyInAnyOrder(
        "CONTACT_NAME_REQUIRED", "CONTACT_PHONE_REQUIRED", "CONTACT_EMAIL_REQUIRED");
  }

  @Test
  void nullSubmission_isAccepted() {
    assertThat(validator.validate(null)).isEmpty();
  }

  // ── helpers ──────────────────────────────────────────────────────

  private static List<String> codes(List<SubmissionValidationError> errors) {
    return errors.stream().map(SubmissionValidationError::code).toList();
  }

  private static FSPSubmissionType submission(String name, String phone, String email) {
    FSPSubmissionMetadataType meta = new FSPSubmissionMetadataType();
    meta.setLicenseeContact(name);
    meta.setTelephoneNumber(phone);
    meta.setEmailAddress(email);
    FSPSubmissionType submission = new FSPSubmissionType();
    submission.setFspSubmissionMetadata(meta);
    return submission;
  }
}
