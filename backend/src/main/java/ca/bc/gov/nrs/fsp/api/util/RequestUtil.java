package ca.bc.gov.nrs.fsp.api.util;

import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * The type Request util.
 */
public class RequestUtil {
  private RequestUtil() {
  }



  // Legacy audit columns (e.g. FSP_NOTIFICATION_DESIGNATE.ENTRY_USERID)
  // are VARCHAR2(30); BCGov FAM Cognito subjects are 46+ chars, so anything
  // we hand to those columns must be capped.
  private static final int LEGACY_AUDIT_USERID_MAX = 30;

  /**
   * Add to existing RequestUtil class.
   * Gets the current authenticated user's username from the Cognito JWT.
   * Cognito puts the username in "username" or "cognito:username" — adjust if needed.
   */
  public static String getCurrentUserName() {
    Jwt jwt = getCurrentJwt();
    String username = jwt.getClaimAsString("username");
    if (username == null) {
      username = jwt.getClaimAsString("cognito:username");
    }
    return username != null ? username : jwt.getSubject();
  }

  /**
   * Resolves the short IDIR ("MAVILLEN"-style) for legacy audit columns.
   * Prefers the {@code custom:idp_username} claim BCGov FAM sets on
   * federated IDIR identities; falls back to {@link #getCurrentUserName()}
   * (truncated) for non-IDIR identities or unit-test contexts without a
   * full claim set.
   */
  public static String getCurrentIdir() {
    try {
      Jwt jwt = getCurrentJwt();
      String idir = jwt.getClaimAsString("custom:idp_username");
      if (idir != null && !idir.isBlank()) {
        return truncate(idir.trim());
      }
      return truncate(getCurrentUserName());
    } catch (RuntimeException ex) {
      return "";
    }
  }

  private static String truncate(String value) {
    if (value == null) return "";
    return value.length() <= LEGACY_AUDIT_USERID_MAX
        ? value
        : value.substring(0, LEGACY_AUDIT_USERID_MAX);
  }

  public static Jwt getCurrentJwt() {
    return (Jwt) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
  }

  // ── Legacy P_USER_ROLE / P_USER_CLIENT_NUMBER helpers ─────────────
  //
  // The FSP_* legacy procs gate on a P_USER_ROLE string in the format
  // SilUser.setUser_roles() produced: comma-separated, trailing comma,
  // e.g. "FSP_ADMINISTRATOR,FSP_DECISION_MAKER,". BCGov FAM serves the
  // role names with an FSPTS_ prefix and an optional suffix (org code
  // like "_DCC" or a forest-client number like "_00012797"). The
  // helpers below collapse the FAM names into the legacy format and
  // pluck the client number out of the suffix when present.
  //
  // These are intentionally cross-cutting and live here (not in any
  // one service) so every DAO wrapper that needs the audit-user
  // context gets the exact same mapping.

  private static final String[] CANONICAL_FSPTS_ROLES = {
      "FSPTS_ADMINISTRATOR", "FSPTS_DECISION_MAKER", "FSPTS_REVIEWER",
      "FSPTS_VIEW_ALL", "FSPTS_SUBMITTER", "FSPTS_VIEW_ONLY",
  };

  /**
   * Returns the current JWT's cognito:groups mapped onto legacy
   * FSP_* role names in the comma-delimited-with-trailing-comma format
   * legacy procs expect. Returns "" if no FSPTS roles are present.
   */
  public static String getCurrentLegacyRoles() {
    try {
      var groups = getCurrentJwt().getClaimAsStringList("cognito:groups");
      if (groups == null || groups.isEmpty()) return "";
      String joined = groups.stream()
          .map(RequestUtil::canonicalLegacyRole)
          .filter(java.util.Objects::nonNull)
          .distinct()
          .collect(java.util.stream.Collectors.joining(","));
      return joined.isEmpty() ? "" : joined + ",";
    } catch (RuntimeException ex) {
      return "";
    }
  }

  /** Strip role suffix (org code or client number) and rewrite FSPTS_ → FSP_. */
  private static String canonicalLegacyRole(String group) {
    for (String role : CANONICAL_FSPTS_ROLES) {
      if (group.equals(role) || group.startsWith(role + "_")) {
        return role.replaceFirst("^FSPTS_", "FSP_");
      }
    }
    return null;
  }

  /**
   * Extracts the 8-digit forest-client number embedded in a role-qualified
   * cognito group (e.g. {@code FSPTS_ADMINISTRATOR_00012797} → "00012797").
   * Non-numeric suffixes (org codes like {@code _DCC}) are ignored. When
   * the user belongs to multiple client-scoped groups the first numeric
   * match wins, mirroring legacy single-client behaviour. Returns "" if
   * no client suffix is found.
   */
  public static String getCurrentClientNumber() {
    try {
      var groups = getCurrentJwt().getClaimAsStringList("cognito:groups");
      if (groups == null || groups.isEmpty()) return "";
      for (String group : groups) {
        for (String role : CANONICAL_FSPTS_ROLES) {
          String prefix = role + "_";
          if (group.startsWith(prefix)) {
            String suffix = group.substring(prefix.length());
            if (suffix.matches("\\d{8}")) {
              return suffix;
            }
          }
        }
      }
      return "";
    } catch (RuntimeException ex) {
      return "";
    }
  }
}