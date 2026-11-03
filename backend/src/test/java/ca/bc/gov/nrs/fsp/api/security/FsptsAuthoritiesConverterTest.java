package ca.bc.gov.nrs.fsp.api.security;

import org.junit.jupiter.api.Test;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The converter collapses a user's FAM roles to a single effective authority
 * (no role stacking): only {@code ROLE_<highest canonical role>} is emitted.
 */
class FsptsAuthoritiesConverterTest {

  private final FsptsAuthoritiesConverter converter = new FsptsAuthoritiesConverter();

  @Test
  void canonicalRole_emitsSingleEffectiveAuthority() {
    Jwt jwt = baseJwtBuilder()
        .claim("client_roles", List.of("FSPTS_ADMINISTRATOR"))
        .build();

    assertThat(authorityNames(converter.convert(jwt)))
        .containsExactly("ROLE_FSPTS_ADMINISTRATOR");
  }

  @Test
  void orgSuffixedRole_emitsCanonicalOnly() {
    Jwt jwt = baseJwtBuilder()
        .claim("client_roles", List.of("FSPTS_ADMINISTRATOR_DPG"))
        .build();

    // The org-suffixed raw authority is no longer emitted — only the canonical.
    assertThat(authorityNames(converter.convert(jwt)))
        .containsExactly("ROLE_FSPTS_ADMINISTRATOR");
  }

  @Test
  void unknownGroup_emitsNoAuthorities() {
    Jwt jwt = baseJwtBuilder()
        .claim("client_roles", List.of("OTHER_GROUP"))
        .build();

    assertThat(converter.convert(jwt)).isEmpty();
  }

  @Test
  void multipleRoles_collapseToHighestPrecedence() {
    Jwt jwt = baseJwtBuilder()
        .claim("client_roles", List.of(
            "FSPTS_REVIEWER",
            "FSPTS_ADMINISTRATOR_DPG",
            "OTHER_GROUP"
        ))
        .build();

    // Administrator outranks Reviewer; unknown groups are ignored.
    assertThat(authorityNames(converter.convert(jwt)))
        .containsExactly("ROLE_FSPTS_ADMINISTRATOR");
  }

  @Test
  void reviewerBeatsViewAll() {
    Jwt jwt = baseJwtBuilder()
        .claim("client_roles", List.of("FSPTS_VIEW_ALL", "FSPTS_REVIEWER"))
        .build();

    assertThat(authorityNames(converter.convert(jwt)))
        .containsExactly("ROLE_FSPTS_REVIEWER");
  }

  @Test
  void clientRoles_collapseToHighest() {
    Jwt jwt = baseJwtBuilder()
        .claim("client_roles", List.of(
            "FSPTS_VIEW_ONLY_FOREST_CLIENT-00067890",
            "FSPTS_SUBMITTER_FOREST_CLIENT-00012345"
        ))
        .build();

    // Submitter outranks View Only; both org-suffixed groups collapse to the
    // single canonical authority.
    assertThat(authorityNames(converter.convert(jwt)))
        .containsExactly("ROLE_FSPTS_SUBMITTER");
  }

  @Test
  void emptyGroups_emitsNoAuthorities() {
    Jwt jwt = baseJwtBuilder().claim("client_roles", List.of()).build();

    assertThat(converter.convert(jwt)).isEmpty();
  }

  @Test
  void missingGroupsClaim_emitsNoAuthorities() {
    Jwt jwt = baseJwtBuilder().build();

    assertThat(converter.convert(jwt)).isEmpty();
  }

  @Test
  void famExpirySidecar_isNotAPrivilege() {
    // FAM records a grant's expiry as a role assigned to the person. It names
    // an Administrator role, but holding it alone grants nothing.
    Jwt jwt = baseJwtBuilder()
        .claim("client_roles", List.of(
            "FSPTS_VIEW_ONLY_FOREST_CLIENT-00012345",
            "FAM:EXPIRES:2026-09-30:FSPTS_ADMINISTRATOR"))
        .build();

    assertThat(authorityNames(converter.convert(jwt)))
        .containsExactly("ROLE_FSPTS_VIEW_ONLY");
  }

  @Test
  void districtScopedRole_mapsToItsBaseRole() {
    Jwt jwt = baseJwtBuilder()
        .claim("client_roles", List.of("FSPTS_DECISION_MAKER_DISTRICT-DCC"))
        .build();

    assertThat(authorityNames(converter.convert(jwt)))
        .containsExactly("ROLE_FSPTS_DECISION_MAKER");
  }

  @Test
  void resourceAccessFallback_isReadWhenClientRolesIsAbsent() {
    // Stock Keycloak mapper shape: resource_access.<azp>.roles.
    Jwt jwt = baseJwtBuilder()
        .claim("azp", "fsp-test-client")
        .claim("resource_access", java.util.Map.of(
            "fsp-test-client", java.util.Map.of("roles", List.of("FSPTS_REVIEWER")),
            "some-other-app", java.util.Map.of("roles", List.of("FSPTS_ADMINISTRATOR"))))
        .build();

    // Only the roles for the client the token was issued to count.
    assertThat(authorityNames(converter.convert(jwt)))
        .containsExactly("ROLE_FSPTS_REVIEWER");
  }

  private static List<String> authorityNames(Collection<GrantedAuthority> authorities) {
    return authorities.stream().map(GrantedAuthority::getAuthority).toList();
  }

  private static Jwt.Builder baseJwtBuilder() {
    return Jwt.withTokenValue("token")
        .header("alg", "RS256")
        .issuedAt(Instant.now())
        .expiresAt(Instant.now().plusSeconds(300));
  }
}
