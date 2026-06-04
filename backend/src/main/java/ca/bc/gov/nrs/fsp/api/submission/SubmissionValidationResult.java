package ca.bc.gov.nrs.fsp.api.submission;

import java.util.List;

public record SubmissionValidationResult(boolean valid, List<SubmissionValidationError> errors) {

  public static SubmissionValidationResult ok() {
    return new SubmissionValidationResult(true, List.of());
  }

  public static SubmissionValidationResult failed(List<SubmissionValidationError> errors) {
    return new SubmissionValidationResult(false, List.copyOf(errors));
  }
}
