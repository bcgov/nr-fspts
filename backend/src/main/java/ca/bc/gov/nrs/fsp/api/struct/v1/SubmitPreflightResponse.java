package ca.bc.gov.nrs.fsp.api.struct.v1;

import java.util.List;

/**
 * Result of GET {@code /v1/fsp/{fspId}/submit/preflight} — surfaces
 * the {@code FSP.*} validation errors the proc-side
 * {@code validate_fsp} would raise on Submit, so the SPA can render
 * them as a checklist before the user clicks Submit.
 *
 * <p>{@code valid} mirrors {@code issues.isEmpty()} — surfaced as its
 * own field so the SPA doesn't have to length-check the array.
 */
public record SubmitPreflightResponse(boolean valid, List<Issue> issues) {

  /**
   * @param code        raw proc error code (e.g. {@code FSP.NO.NAME}).
   * @param procMessage what {@code fsp_error.get_error_messages}
   *                    returned — typically the same text but
   *                    parameter-substituted for the
   *                    {@code FSP.COMMON.*} family.
   * @param message     curated user-facing message from
   *                    {@code ProcErrorMessages}; falls back to the
   *                    proc message when the code isn't curated.
   */
  public record Issue(String code, String procMessage, String message) {}
}
