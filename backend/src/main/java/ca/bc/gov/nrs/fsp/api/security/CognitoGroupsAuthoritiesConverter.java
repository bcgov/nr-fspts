package ca.bc.gov.nrs.fsp.api.security;

import org.springframework.core.convert.converter.Converter;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Maps {@code cognito:groups} entries to Spring Security authorities.
 *
 * <p><b>No role stacking.</b> A user's groups are collapsed to their single
 * highest-precedence canonical role (see {@link FsptsRoles#highest}), and only
 * that role is exposed as {@code ROLE_<CANONICAL>} (e.g.
 * {@code ROLE_FSPTS_ADMINISTRATOR}). The {@code @PreAuthorize} matrix uses the
 * bare {@code FSPTS_*} names, so it sees exactly one role and capabilities can
 * never be the union of several roles.
 *
 * <p>Method security is intentionally coarse here (does this role perform this
 * kind of write at all). Per-FSP / per-client scoping — including a client-tied
 * user who is, say, a Submitter for one client but View-Only for another — is
 * enforced by the legacy {@code user_may_access} fence using the active-org
 * client number, which {@code RequestUtil.getEffectiveRole()} resolves.
 */
public class CognitoGroupsAuthoritiesConverter implements Converter<Jwt, Collection<GrantedAuthority>> {

  private static final String GROUPS_CLAIM = "cognito:groups";
  private static final String AUTHORITY_PREFIX = "ROLE_";

  @Override
  public Collection<GrantedAuthority> convert(Jwt jwt) {
    List<String> groups = jwt.getClaimAsStringList(GROUPS_CLAIM);
    if (groups == null || groups.isEmpty()) {
      return List.of();
    }
    Set<String> canonicalRoles = new LinkedHashSet<>();
    for (String group : groups) {
      String canonical = FsptsRoles.canonicalRoleFor(group);
      if (canonical != null) {
        canonicalRoles.add(canonical);
      }
    }
    String effective = FsptsRoles.highest(canonicalRoles);
    if (effective == null) {
      return List.of();
    }
    return List.of(new SimpleGrantedAuthority(AUTHORITY_PREFIX + effective));
  }
}
