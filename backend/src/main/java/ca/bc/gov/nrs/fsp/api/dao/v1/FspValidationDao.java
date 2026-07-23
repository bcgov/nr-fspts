package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.util.List;

/**
 * Runs the proc-side validation chain for a Submit preflight —
 * {@code fsp_common_validation.validate_fsp} accumulates every
 * {@code FSP.*} error via {@code fsp_error.set_error}, and we read
 * them back via {@code fsp_error.get_error_keys} /
 * {@code fsp_error.get_error_messages}. No writes; safe to call from a
 * GET endpoint.
 */
public interface FspValidationDao {

  /** Single accumulated error from the proc-side validation chain. */
  record ValidationError(String code, String procMessage) {}

  /**
   * The three "declared an update but carries no change" inputs the
   * Draft→Submitted branch of {@code validate_status_change} checks, read for
   * a specific amendment. {@code validate_fsp} (the preflight chain) does NOT
   * run that branch, so the Submit preflight replicates it from this state.
   *
   * <p>{@code *UpdateInd} are the plan's {@code fdu/identified_areas/
   * stocking_standard_update_ind} flags ('Y'/'N'); the {@code *HasChanges}
   * booleans are the live results of {@code fsp_common_db.has_fdu_changes /
   * has_identified_area_changes / has_stocking_standard_changes} — the exact
   * functions SUBMIT calls, so the preflight matches submit behaviour. A rule
   * only bites when an indicator is 'Y' and its matching hasChanges is false.
   */
  record UpdateIndicatorState(
      String amendmentCode,
      String transitionInd,
      String fduUpdateInd,
      boolean fduHasChanges,
      String iaUpdateInd,
      boolean iaHasChanges,
      String ssUpdateInd,
      boolean ssHasChanges) {}

  /**
   * Returns every error accumulated by validating the given
   * {@code (fspId, amendmentNumber)} against the production tables.
   * Empty list ⇒ Submit would succeed (from a validation standpoint).
   *
   * <p>Resets the session-scoped error buffer before AND after the
   * validation call so unrelated requests sharing the same connection
   * can't leak codes into each other.
   */
  List<ValidationError> validate(long fspId, long amendmentNumber);

  /**
   * Reads the update indicators + amendment code + transition flag for
   * {@code (fspId, amendmentNumber)} and evaluates the three
   * {@code has_*_changes} functions in one round trip. Returns a state whose
   * {@code *UpdateInd} fields are null when the FSP/amendment row doesn't
   * exist (caller then skips the checks).
   */
  UpdateIndicatorState getUpdateIndicatorState(long fspId, long amendmentNumber);
}
