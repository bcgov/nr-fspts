package ca.bc.gov.nrs.fsp.api.submission.validator;

import ca.bc.gov.nrs.fsp.api.submission.SubmissionValidationError;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionMetadataType;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.FSPSubmissionType;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * The plan-contact details (name, telephone, email) live in
 * {@code <fspSubmissionMetadata>} and are carried on every submission
 * (Initial and amendment/replacement alike — they are not carried forward
 * from a prior amendment). The FSP_300 SAVE proc rejects a submission
 * missing any of them ({@code FSP.NO.CONTACT.PERSON / .PHONE / .EMAIL}),
 * but that only fires at persist time. Catch the same gaps here at the
 * validation stage so the submitter sees a friendly issue in the list
 * instead of a persist-time failure.
 *
 * <p>Lengths are checked here too. These three map straight onto
 * {@code FOREST_STEWARDSHIP_PLAN.CONTACT_NAME VARCHAR2(120)},
 * {@code .TELEPHONE_NUMBER VARCHAR2(10)} and
 * {@code .EMAIL_ADDRESS VARCHAR2(120)}, and nothing between the parser and
 * the proc bounds them — an over-long value reached Oracle and came back as
 * a raw {@code ORA-12899} 500 rather than a validation issue. The phone rule
 * is exactly ten digits, matching what the UI edit form already enforces
 * (InformationTab's {@code /^\d{10}$/}); a separator-formatted number like
 * "250-720-6237" is 12 characters and overflows the column.
 */
@Component
@Slf4j
public class ContactDetailsValidator {

  /** {@code FOREST_STEWARDSHIP_PLAN.CONTACT_NAME} / {@code .EMAIL_ADDRESS}. */
  private static final int MAX_NAME_LEN = 120;
  private static final int MAX_EMAIL_LEN = 120;

  public List<SubmissionValidationError> validate(FSPSubmissionType submission) {
    List<SubmissionValidationError> errors = new ArrayList<>();
    if (submission == null) {
      return errors;
    }
    FSPSubmissionMetadataType meta = submission.getFspSubmissionMetadata();

    String contactName = meta == null ? null : meta.getLicenseeContact();
    String phone = meta == null ? null : meta.getTelephoneNumber();
    String email = meta == null ? null : meta.getEmailAddress();

    if (isBlank(contactName)) {
      errors.add(SubmissionValidationError.of(
          "fspSubmissionMetadata/licenseeContact",
          "CONTACT_NAME_REQUIRED",
          "Contact name is required."));
    } else if (contactName.trim().length() > MAX_NAME_LEN) {
      errors.add(SubmissionValidationError.of(
          "fspSubmissionMetadata/licenseeContact",
          "CONTACT_NAME_TOO_LONG",
          "Contact name must be " + MAX_NAME_LEN + " characters or fewer (got "
              + contactName.trim().length() + ")."));
    }

    if (isBlank(phone)) {
      errors.add(SubmissionValidationError.of(
          "fspSubmissionMetadata/telephoneNumber",
          "CONTACT_PHONE_REQUIRED",
          "Contact telephone number is required."));
    } else if (!phone.trim().matches("\\d{10}")) {
      errors.add(SubmissionValidationError.of(
          "fspSubmissionMetadata/telephoneNumber",
          "CONTACT_PHONE_INVALID",
          "Contact telephone number must be exactly 10 digits with no spaces,"
              + " dashes or brackets (e.g. 2507206237) — got \""
              + phone.trim() + "\"."));
    }

    if (isBlank(email)) {
      errors.add(SubmissionValidationError.of(
          "fspSubmissionMetadata/emailAddress",
          "CONTACT_EMAIL_REQUIRED",
          "Contact email address is required."));
    } else if (email.trim().length() > MAX_EMAIL_LEN) {
      errors.add(SubmissionValidationError.of(
          "fspSubmissionMetadata/emailAddress",
          "CONTACT_EMAIL_TOO_LONG",
          "Contact email address must be " + MAX_EMAIL_LEN
              + " characters or fewer (got " + email.trim().length() + ")."));
    }
    return errors;
  }

  private static boolean isBlank(String value) {
    return value == null || value.isBlank();
  }
}
