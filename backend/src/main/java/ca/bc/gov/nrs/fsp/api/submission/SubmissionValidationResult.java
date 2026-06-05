package ca.bc.gov.nrs.fsp.api.submission;

import java.util.List;

/**
 * The validate-endpoint response shape. {@code preview} is populated
 * whenever the XML parses far enough to extract a submission tree —
 * even when subsequent geometry/schema checks fail — so the upload UI
 * can show the user what they've staged alongside the validation issues.
 * Null when an envelope/parse failure prevented any structural read.
 */
public record SubmissionValidationResult(
    boolean valid,
    List<SubmissionValidationError> errors,
    SubmissionPreview preview) {

  public static SubmissionValidationResult ok(SubmissionPreview preview) {
    return new SubmissionValidationResult(true, List.of(), preview);
  }

  public static SubmissionValidationResult failed(
      List<SubmissionValidationError> errors, SubmissionPreview preview) {
    return new SubmissionValidationResult(false, List.copyOf(errors), preview);
  }
}
