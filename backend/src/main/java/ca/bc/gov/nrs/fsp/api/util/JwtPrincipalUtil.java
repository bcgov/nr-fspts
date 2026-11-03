package ca.bc.gov.nrs.fsp.api.util;

import java.util.Locale;
import java.util.Map;

/**
 * Reads who the caller is from a BC Gov SSO (Keycloak) access token.
 *
 * <p>FSP signs in through two providers on the standard realm. The claim names
 * follow the SSO identity-mappers reference
 * (https://bcgov.github.io/sso-docs/advanced/identity-mappers):
 *
 * <table border="1">
 *   <caption>What replaced the Cognito {@code custom:idp_*} claims</caption>
 *   <tr><th>Field</th><th>Cognito (was)</th><th>IDIR - MFA</th><th>BCeID Business</th></tr>
 *   <tr><td>username</td><td>{@code custom:idp_username}</td>
 *       <td>{@code idir_username}</td><td>{@code bceid_username}</td></tr>
 *   <tr><td>user GUID</td><td>{@code custom:idp_user_id}</td>
 *       <td>{@code idir_user_guid}</td><td>{@code bceid_user_guid}</td></tr>
 *   <tr><td>provider</td><td>{@code custom:idp_name}</td>
 *       <td colspan="2">{@code identity_provider}</td></tr>
 * </table>
 *
 * <p>Two rules here keep the audit columns joining up with rows written before
 * the move:
 * <ul>
 *   <li><b>Provider aliases are normalised.</b> IDIR - MFA reports
 *   {@code identity_provider} as {@code azureidir}; passing that through would
 *   start writing {@code AZUREIDIR\jsmith} for the same person who has always
 *   been {@code IDIR\jsmith}. Every IDIR alias becomes {@code IDIR}, every BCeID
 *   alias becomes {@code BCEID}.</li>
 *   <li><b>GUIDs are upper-cased.</b> The GUID is only used when the username
 *   claim is missing, and the token can carry it in either case. Upper-casing
 *   keeps one person from becoming two IDs. Usernames are left as issued.</li>
 * </ul>
 */
public final class JwtPrincipalUtil {

  static final String PROVIDER_IDIR = "IDIR";
  static final String PROVIDER_BCEID = "BCEID";

  private JwtPrincipalUtil() {}

  /**
   * {@code IDIR} or {@code BCEID}, or "" when the token names a provider FSP
   * doesn't recognise. Falls back to the {@code preferred_username} suffix
   * ({@code <guid>@azureidir}), which is always present.
   */
  public static String provider(Map<String, Object> claims) {
    String raw = claim(claims, "identity_provider");
    if (raw.isBlank()) {
      String preferred = claim(claims, "preferred_username");
      int at = preferred.indexOf('@');
      raw = at < 0 ? "" : preferred.substring(at + 1);
    }
    return switch (raw.trim().toLowerCase(Locale.ROOT)) {
      case "idir", "azureidir" -> PROVIDER_IDIR;
      case "bceidbusiness", "bceidboth", "bceidbasic" -> PROVIDER_BCEID;
      default -> "";
    };
  }

  /**
   * The short username ({@code JSMITH}, {@code some.bceid.user}), falling back to
   * the upper-cased GUID when the username claim isn't mapped onto the access
   * token. "" when neither is present.
   */
  public static String username(Map<String, Object> claims) {
    for (String name : new String[] {"idir_username", "bceid_username"}) {
      String value = claim(claims, name).trim();
      if (!value.isEmpty()) return value;
    }
    for (String name : new String[] {"idir_user_guid", "bceid_user_guid"}) {
      String value = claim(claims, name).trim();
      if (!value.isEmpty()) return value.toUpperCase(Locale.ROOT);
    }
    return "";
  }

  /**
   * {@code IDIR\JSMITH} / {@code BCEID\some.user}, the form the legacy audit
   * columns hold. No prefix when the provider isn't recognised (better
   * unprefixed than wrong); "" when there's no username.
   */
  public static String auditUserId(Map<String, Object> claims) {
    String username = username(claims);
    if (username.isEmpty()) return "";
    String provider = provider(claims);
    return provider.isEmpty() ? username : provider + "\\" + username;
  }

  private static String claim(Map<String, Object> claims, String name) {
    Object value = claims == null ? null : claims.get(name);
    return value == null ? "" : value.toString();
  }
}
