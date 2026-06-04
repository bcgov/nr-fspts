package ca.bc.gov.nrs.fsp.api.submission;

public record SubmissionValidationError(String path, String code, String message) {

  public static SubmissionValidationError of(String code, String message) {
    return new SubmissionValidationError(null, code, message);
  }

  public static SubmissionValidationError of(String path, String code, String message) {
    return new SubmissionValidationError(path, code, message);
  }
}
