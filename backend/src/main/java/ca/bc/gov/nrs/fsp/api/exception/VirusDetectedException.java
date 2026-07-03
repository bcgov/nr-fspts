package ca.bc.gov.nrs.fsp.api.exception;

import ca.bc.gov.nrs.fsp.api.service.v1.VirusScanner;
import lombok.Getter;

/**
 * Thrown by the throw-style upload paths (attachment uploads) when the
 * virus scanner rejects a file — either because a signature was found
 * or because the scanner could not verify the file under a fail-closed
 * policy.
 *
 * <p>Mapped to HTTP 422 (UNPROCESSABLE_ENTITY) in
 * {@code RestExceptionHandler}. The submission-validation flow does
 * <b>not</b> use this exception — it folds the same rejection into a
 * {@code SubmissionValidationResult} that already rides a 422.
 */
@Getter
public class VirusDetectedException extends RuntimeException {

  /** The scanner rejection carrying the machine code + user message. */
  private final transient VirusScanner.Rejection rejection;

  public VirusDetectedException(VirusScanner.Rejection rejection) {
    super(rejection.message());
    this.rejection = rejection;
  }
}
