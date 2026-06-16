package ca.bc.gov.nrs.fsp.api.notification;

import java.util.Optional;

/**
 * Resolves an IDIR username (e.g. {@code "IDIR\\JSMITH"}) to the
 * email address the designate digest should deliver to. Implementations
 * run from the scheduler thread, so they cannot rely on a per-request
 * JWT being in scope.
 */
public interface DesignateEmailResolver {
  Optional<String> resolveEmail(String designateIdir);
}
