package ca.bc.gov.nrs.fsp.api.submission.parser;

/**
 * Thrown by {@link SubmissionEnvelopeStripper} when the upload's root
 * element is not a recognised submission envelope (or extraction of
 * the inner fsp:fspSubmission body fails). The {@code code} maps to
 * a {@code SubmissionValidationError.code}.
 */
public class SubmissionEnvelopeException extends Exception {

  private final String code;

  public SubmissionEnvelopeException(String code, String message) {
    super(message);
    this.code = code;
  }

  public SubmissionEnvelopeException(String code, String message, Throwable cause) {
    super(message, cause);
    this.code = code;
  }

  public String getCode() {
    return code;
  }
}
