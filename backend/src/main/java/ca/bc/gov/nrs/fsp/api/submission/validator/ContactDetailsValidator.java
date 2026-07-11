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
 */
@Component
@Slf4j
public class ContactDetailsValidator {

  public List<SubmissionValidationError> validate(FSPSubmissionType submission) {
    List<SubmissionValidationError> errors = new ArrayList<>();
    if (submission == null) {
      return errors;
    }
    FSPSubmissionMetadataType meta = submission.getFspSubmissionMetadata();

    if (isBlank(meta == null ? null : meta.getLicenseeContact())) {
      errors.add(SubmissionValidationError.of(
          "fspSubmissionMetadata/licenseeContact",
          "CONTACT_NAME_REQUIRED",
          "Contact name is required."));
    }
    if (isBlank(meta == null ? null : meta.getTelephoneNumber())) {
      errors.add(SubmissionValidationError.of(
          "fspSubmissionMetadata/telephoneNumber",
          "CONTACT_PHONE_REQUIRED",
          "Contact telephone number is required."));
    }
    if (isBlank(meta == null ? null : meta.getEmailAddress())) {
      errors.add(SubmissionValidationError.of(
          "fspSubmissionMetadata/emailAddress",
          "CONTACT_EMAIL_REQUIRED",
          "Contact email address is required."));
    }
    return errors;
  }

  private static boolean isBlank(String value) {
    return value == null || value.isBlank();
  }
}
