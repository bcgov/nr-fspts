package ca.bc.gov.nrs.fsp.api.security;

import java.util.Collection;
import java.util.List;
import java.util.Set;

/**
 * Canonical FSPTS role names.
 *
 * <p>A token role maps to a canonical role by its <em>base</em> name, after the
 * FAM scope suffixes are removed ({@link FamRoles#parse}): so
 * {@code FSPTS_SUBMITTER_FOREST_CLIENT-00012345} is a Submitter for client
 * {@code 00012345}. A base that equals the canonical name or starts with it
 * plus an underscore also matches, which covers organization-named roles
 * carried over verbatim from the old FAM (e.g. {@code FSPTS_ADMINISTRATOR_DPG}).
 *
 * <p><b>No role stacking.</b> A user resolves to a single <em>effective</em>
 * role — capabilities are never the union of several roles. The four internal
 * roles are mutually exclusive and a user is never both an internal role and a
 * client-tied one; a client-tied user party to multiple clients selects one
 * active client and is scoped to the role they hold for it. When more than one
 * role is somehow present, {@link #highest(Collection)} picks the single
 * winner by {@link #PRECEDENCE}.
 */
public final class FsptsRoles {

  public static final String ADMINISTRATOR   = "FSPTS_ADMINISTRATOR";
  public static final String DECISION_MAKER  = "FSPTS_DECISION_MAKER";
  public static final String REVIEWER        = "FSPTS_REVIEWER";
  public static final String VIEW_ALL        = "FSPTS_VIEW_ALL";
  public static final String SUBMITTER       = "FSPTS_SUBMITTER";
  public static final String VIEW_ONLY       = "FSPTS_VIEW_ONLY";

  public static final List<String> ALL = List.of(
      ADMINISTRATOR, DECISION_MAKER, REVIEWER, VIEW_ALL, SUBMITTER, VIEW_ONLY
  );

  /**
   * Role precedence, highest first. Used to collapse a user to a single
   * effective role. The four internal roles outrank the two client-tied
   * roles, so an internal role always wins a tie. (Kept explicit rather than
   * reusing {@link #ALL} so a reorder of {@code ALL} can't silently change
   * authorization.)
   */
  public static final List<String> PRECEDENCE = List.of(
      ADMINISTRATOR, DECISION_MAKER, REVIEWER, VIEW_ALL, SUBMITTER, VIEW_ONLY
  );

  /** The four internal (non-client-scoped) roles. */
  public static final Set<String> INTERNAL = Set.of(
      ADMINISTRATOR, DECISION_MAKER, REVIEWER, VIEW_ALL
  );

  /** True for the internal roles (Administrator / Decision Maker / Reviewer / View All). */
  public static boolean isInternal(String canonicalRole) {
    return INTERNAL.contains(canonicalRole);
  }

  /**
   * The highest-precedence role among the given canonical roles, or
   * {@code null} if none are present.
   */
  public static String highest(Collection<String> canonicalRoles) {
    if (canonicalRoles == null || canonicalRoles.isEmpty()) return null;
    for (String role : PRECEDENCE) {
      if (canonicalRoles.contains(role)) return role;
    }
    return null;
  }

  private FsptsRoles() {}

  /**
   * Returns the canonical FSPTS role that the given token role grants, or
   * {@code null} if it doesn't map to any known role. The FAM scope suffixes
   * are removed first; the remaining base matches a role when it equals the
   * role name or starts with {@code role + "_"}.
   */
  public static String canonicalRoleFor(String tokenRole) {
    String base = FamRoles.parse(tokenRole).baseRole();
    if (base == null) return null;
    for (String role : ALL) {
      if (base.equals(role) || base.startsWith(role + "_")) {
        return role;
      }
    }
    return null;
  }

  /**
   * The 8-digit forest-client number a token role is scoped to
   * ({@code FSPTS_SUBMITTER_FOREST_CLIENT-00012345} → {@code 00012345}), or
   * {@code null} when it isn't an FSPTS role or carries no client scope.
   */
  public static String clientNumberFor(String tokenRole) {
    if (canonicalRoleFor(tokenRole) == null) return null;
    String client = FamRoles.parse(tokenRole).scopeValue(FamRoles.SCOPE_FOREST_CLIENT);
    return client != null && client.matches("\\d{8}") ? client : null;
  }
}
