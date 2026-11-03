package ca.bc.gov.nrs.fsp.api.security;

import org.springframework.security.oauth2.jwt.Jwt;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Reads FAM roles off a BC Gov SSO (Keycloak) access token.
 *
 * <h2>Where the roles are</h2>
 * CSS puts the caller's roles for the client the token was issued to in
 * {@code client_roles}. Stock Keycloak puts the same thing in
 * {@code resource_access.<azp>.roles}. Which one a token carries depends on the
 * realm's mappers, so both are read.
 *
 * <h2>How a scoped grant is named</h2>
 * A CSS role is a bare name, so FAM writes the scope into it at grant time:
 * {@code FSPTS_SUBMITTER_FOREST_CLIENT-00012345}. A scoped holder carries only
 * that name; the bare {@code FSPTS_SUBMITTER} is not in their token. Several
 * scopes chain in a fixed order (district, region, forest client), e.g.
 * {@code FSPTS_SUBMITTER_DISTRICT-DCC_FOREST_CLIENT-00012345}.
 *
 * <p>{@link #parse} follows FAM's own grammar ({@code CssRoleNaming.parse} in
 * nr-fam): it peels suffixes from the right, taking everything after the last
 * {@code -} as the value and matching a known scope type before it, longest
 * first. It never splits on underscores, because {@code FOREST_CLIENT} and
 * region values such as {@code KOOTENAY_BOUNDARY} contain them.
 *
 * <h2>FAM's bookkeeping roles</h2>
 * FAM records a grant's expiry as a role assigned to the person, e.g.
 * {@code FAM:EXPIRES:2026-09-30:FSPTS_SUBMITTER_FOREST_CLIENT-00012345}. It
 * reaches the token like any other role, so every {@code FAM:} entry is dropped
 * here before anything reads the list as privileges.
 */
public final class FamRoles {

  private static final String CLAIM_CLIENT_ROLES = "client_roles";
  private static final String CLAIM_RESOURCE_ACCESS = "resource_access";
  private static final String CLAIM_AZP = "azp";
  private static final String FAM_SIDECAR_PREFIX = "FAM:";

  public static final String SCOPE_DISTRICT = "DISTRICT";
  public static final String SCOPE_REGION = "REGION";
  public static final String SCOPE_FOREST_CLIENT = "FOREST_CLIENT";

  /** Longest first, so {@code _FOREST_CLIENT} is never read as some shorter type. */
  private static final List<String> SCOPE_TYPES =
      List.of(SCOPE_FOREST_CLIENT, SCOPE_DISTRICT, SCOPE_REGION);

  private FamRoles() {}

  /** The caller's roles for this client, with FAM's {@code FAM:} sidecars removed. */
  public static List<String> fromJwt(Jwt jwt) {
    if (jwt == null) return List.of();
    List<String> roles = jwt.getClaimAsStringList(CLAIM_CLIENT_ROLES);
    if (roles == null || roles.isEmpty()) {
      roles = rolesFromResourceAccess(jwt);
    }
    return roles.stream()
        .filter(role -> role != null && !role.startsWith(FAM_SIDECAR_PREFIX))
        .toList();
  }

  /** {@code resource_access.<azp>.roles}, or an empty list when absent or malformed. */
  private static List<String> rolesFromResourceAccess(Jwt jwt) {
    Object resourceAccess = jwt.getClaim(CLAIM_RESOURCE_ACCESS);
    String clientId = jwt.getClaimAsString(CLAIM_AZP);
    if (!(resourceAccess instanceof Map<?, ?> byClient) || clientId == null) {
      return List.of();
    }
    if (byClient.get(clientId) instanceof Map<?, ?> entry
        && entry.get("roles") instanceof List<?> roles) {
      return roles.stream()
          .filter(String.class::isInstance)
          .map(String.class::cast)
          .toList();
    }
    return List.of();
  }

  /**
   * Splits a role name into its base role and the scopes FAM appended.
   *
   * <pre>
   * FSPTS_SUBMITTER_FOREST_CLIENT-00012345           -> FSPTS_SUBMITTER, [FOREST_CLIENT=00012345]
   * FSPTS_REVIEWER_DISTRICT-DCC_FOREST_CLIENT-0001   -> FSPTS_REVIEWER, [DISTRICT=DCC, FOREST_CLIENT=0001]
   * FSPTS_VIEW_ALL_REGION-KOOTENAY_BOUNDARY          -> FSPTS_VIEW_ALL, [REGION=KOOTENAY_BOUNDARY]
   * FSPTS_ADMINISTRATOR                              -> FSPTS_ADMINISTRATOR, []
   * SOME-ROLE                                        -> SOME-ROLE, []
   * </pre>
   */
  public static Parsed parse(String roleName) {
    if (roleName == null) return new Parsed(null, List.of());
    List<Scope> scopes = new ArrayList<>();
    String remaining = roleName;
    while (true) {
      int hyphen = remaining.lastIndexOf('-');
      if (hyphen < 0) break;
      String head = remaining.substring(0, hyphen);
      String value = remaining.substring(hyphen + 1);
      String matched = null;
      for (String type : SCOPE_TYPES) {
        String suffix = "_" + type;
        if (head.endsWith(suffix) && head.length() > suffix.length()) {
          matched = type;
          break;
        }
      }
      // A hyphen that isn't a scope separator: what's left is the base role.
      if (matched == null) break;
      scopes.add(new Scope(matched, value));
      remaining = head.substring(0, head.length() - matched.length() - 1);
    }
    Collections.reverse(scopes);
    return new Parsed(remaining, List.copyOf(scopes));
  }

  /** One dimension a grant is scoped by, e.g. {@code FOREST_CLIENT} of {@code 00012345}. */
  public record Scope(String type, String value) {}

  /** A role name split into the base role and its scopes, in the order written. */
  public record Parsed(String baseRole, List<Scope> scopes) {

    /** The value of the given scope type, or null when the role isn't scoped by it. */
    public String scopeValue(String type) {
      for (Scope scope : scopes) {
        if (scope.type().equals(type)) return scope.value();
      }
      return null;
    }
  }
}
