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
   * Returns every error accumulated by validating the given
   * {@code (fspId, amendmentNumber)} against the production tables.
   * Empty list ⇒ Submit would succeed (from a validation standpoint).
   *
   * <p>Resets the session-scoped error buffer before AND after the
   * validation call so unrelated requests sharing the same connection
   * can't leak codes into each other.
   */
  List<ValidationError> validate(long fspId, long amendmentNumber);
}
