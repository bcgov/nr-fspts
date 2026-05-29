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
}