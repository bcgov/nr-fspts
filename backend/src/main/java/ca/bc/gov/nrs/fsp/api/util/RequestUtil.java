package ca.bc.gov.nrs.fsp.api.util;

import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

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

  /**
   * Like {@link #getCurrentIdir()} but prefixed with the AD-style
   * directory name — {@code IDIR\MAVILLEN}, {@code BCEID\some.user},
   * etc. — matching what the legacy submission writer stamped into the
   * ENTRY_USERID / UPDATE_USERID audit columns.
   *
   * <p>Provider is read from the {@code custom:idp_name} claim (BCGov
   * FAM sets {@code IDIR} or {@code BCEIDBUSINESS}). Anything starting
   * with "BCEID" maps to the {@code BCEID\} prefix; "IDIR" maps to
   * {@code IDIR\}; unknown providers get no prefix (we'd rather be
   * un-prefixed than lie about the directory).
   *
   * <p>Final value is truncated to {@link #LEGACY_AUDIT_USERID_MAX} so
   * the prefixed string still fits the VARCHAR2(30) audit columns.
   */
  public static String getCurrentAuditUserId() {
    try {
      Jwt jwt = getCurrentJwt();
      String username = jwt.getClaimAsString("custom:idp_username");
      if (username == null || username.isBlank()) {
        username = getCurrentUserName();
      }
      if (username == null || username.isBlank()) return "";
      String prefix = resolveDirectoryPrefix(jwt);
      return truncate(prefix + username.trim());
    } catch (RuntimeException ex) {
      return "";
    }
  }

  /**
   * Picks the {@code IDIR\} / {@code BCEID\} prefix in order of
   * trustworthiness. Returns empty string if no signal is available
   * (better to leave the audit value un-prefixed than guess wrong).
   *
   * <ol>
   *   <li>{@code custom:idp_name} claim if BCGov FAM put it on the
   *       access token ({@code IDIR} or {@code BCEIDBUSINESS}).</li>
   *   <li>The {@code cognito:username} pattern Cognito generates for
   *       federated identities — {@code idir_<guid>} or
   *       {@code <guid>@idir} → IDIR; {@code bceid…} variants → BCEID.</li>
   * </ol>
   */
  private static String resolveDirectoryPrefix(Jwt jwt) {
    String idpName = jwt.getClaimAsString("custom:idp_name");
    if (idpName != null && !idpName.isBlank()) {
      String upper = idpName.trim().toUpperCase();
      if ("IDIR".equals(upper)) return "IDIR\\";
      if (upper.startsWith("BCEID")) return "BCEID\\";
    }
    String cognitoUsername = jwt.getClaimAsString("cognito:username");
    if (cognitoUsername == null) cognitoUsername = jwt.getClaimAsString("username");
    if (cognitoUsername != null) {
      String lower = cognitoUsername.toLowerCase();
      if (lower.startsWith("idir_") || lower.endsWith("@idir") || lower.contains("\\idir\\")) {
        return "IDIR\\";
      }
      if (lower.startsWith("bceid") || lower.contains("bceidbusiness")) {
        return "BCEID\\";
      }
    }
    return "";
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
   * Header sent by the SPA when a BCeID submitter has picked an active
   * org from the multi-client picker. Validated against the user's own
   * JWT groups before being used — a forged value that isn't a real
   * scope for the user is dropped silently and we fall back to the
   * legacy "first match wins" behaviour.
   */
  private static final String ACTIVE_ORG_HEADER = "X-FSPTS-Active-Org-Client-Number";

  /**
   * Extracts the 8-digit forest-client number that should scope this
   * request's database queries.
   *
   * <p>Resolution order:
   * <ol>
   *   <li>{@code X-FSPTS-Active-Org-Client-Number} header (set by the
   *       SPA after the BCeID multi-org picker) — IF it appears as a
   *       numeric suffix on one of the JWT's groups, return it.</li>
   *   <li>Otherwise the first numeric suffix in the user's groups —
   *       mirrors legacy single-client behaviour for IDIR users and
   *       single-org BCeID users.</li>
   *   <li>Empty string if no client suffix exists at all.</li>
   * </ol>
   */
  public static String getCurrentClientNumber() {
    try {
      var groups = getCurrentJwt().getClaimAsStringList("cognito:groups");
      if (groups == null || groups.isEmpty()) return "";
      var ownClientNumbers = collectClientNumberSuffixes(groups);
      if (ownClientNumbers.isEmpty()) return "";
      String requested = readActiveOrgHeader();
      if (requested != null && ownClientNumbers.contains(requested)) {
        return requested;
      }
      return ownClientNumbers.iterator().next();
    } catch (RuntimeException ex) {
      return "";
    }
  }

  private static java.util.LinkedHashSet<String> collectClientNumberSuffixes(
      java.util.List<String> groups) {
    var result = new java.util.LinkedHashSet<String>();
    for (String group : groups) {
      for (String role : CANONICAL_FSPTS_ROLES) {
        String prefix = role + "_";
        if (group.startsWith(prefix)) {
          String suffix = group.substring(prefix.length());
          if (suffix.matches("\\d{8}")) {
            result.add(suffix);
          }
        }
      }
    }
    return result;
  }

  private static String readActiveOrgHeader() {
    try {
      var attrs = RequestContextHolder.getRequestAttributes();
      if (!(attrs instanceof ServletRequestAttributes sra)) return null;
      String raw = sra.getRequest().getHeader(ACTIVE_ORG_HEADER);
      if (raw == null) return null;
      String trimmed = raw.trim();
      return trimmed.matches("\\d{8}") ? trimmed : null;
    } catch (RuntimeException ex) {
      return null;
    }
  }

  /**
   * True when the current JWT carries {@code FSPTS_ADMINISTRATOR} as
   * one of its cognito groups (with or without an org/client suffix).
   */
  public static boolean isCurrentUserAdmin() {
    return hasFsptsRole("FSPTS_ADMINISTRATOR");
  }

  /** True when the JWT carries {@code FSPTS_DECISION_MAKER} (with or without suffix). */
  public static boolean isCurrentUserDecisionMaker() {
    return hasFsptsRole("FSPTS_DECISION_MAKER");
  }

  /** True when the JWT carries {@code FSPTS_REVIEWER} (with or without suffix). */
  public static boolean isCurrentUserReviewer() {
    return hasFsptsRole("FSPTS_REVIEWER");
  }

  /**
   * Shared FSPTS-role match. A role is "present" if the JWT carries it
   * exactly or as an org/client-suffixed variant (e.g.
   * {@code FSPTS_ADMINISTRATOR_00012797}).
   */
  private static boolean hasFsptsRole(String role) {
    try {
      var groups = getCurrentJwt().getClaimAsStringList("cognito:groups");
      if (groups == null || groups.isEmpty()) return false;
      String prefix = role + "_";
      for (String group : groups) {
        if (role.equals(group) || group.startsWith(prefix)) {
          return true;
        }
      }
      return false;
    } catch (RuntimeException ex) {
      return false;
    }
  }
}