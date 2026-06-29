package ca.bc.gov.nrs.fsp.api.security;

import org.junit.jupiter.api.Test;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The converter collapses a user's groups to a single effective authority (no
 * role stacking): only {@code ROLE_<highest canonical role>} is emitted.
 */
class CognitoGroupsAuthoritiesConverterTest {

  private final CognitoGroupsAuthoritiesConverter converter = new CognitoGroupsAuthoritiesConverter();

  @Test
  void canonicalRole_emitsSingleEffectiveAuthority() {
    Jwt jwt = baseJwtBuilder()
        .claim("cognito:groups", List.of("FSPTS_ADMINISTRATOR"))
        .build();

    assertThat(authorityNames(converter.convert(jwt)))
        .containsExactly("ROLE_FSPTS_ADMINISTRATOR");
  }

  @Test
  void orgSuffixedRole_emitsCanonicalOnly() {
    Jwt jwt = baseJwtBuilder()
        .claim("cognito:groups", List.of("FSPTS_ADMINISTRATOR_DPG"))
        .build();

    // The org-suffixed raw authority is no longer emitted — only the canonical.
    assertThat(authorityNames(converter.convert(jwt)))
        .containsExactly("ROLE_FSPTS_ADMINISTRATOR");
  }

  @Test
  void unknownGroup_emitsNoAuthorities() {
    Jwt jwt = baseJwtBuilder()
        .claim("cognito:groups", List.of("OTHER_GROUP"))
        .build();

    assertThat(converter.convert(jwt)).isEmpty();
  }

  @Test
  void multipleRoles_collapseToHighestPrecedence() {
    Jwt jwt = baseJwtBuilder()
        .claim("cognito:groups", List.of(
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
        .claim("cognito:groups", List.of("FSPTS_VIEW_ALL", "FSPTS_REVIEWER"))
        .build();

    assertThat(authorityNames(converter.convert(jwt)))
        .containsExactly("ROLE_FSPTS_REVIEWER");
  }

  @Test
  void clientRoles_collapseToHighest() {
    Jwt jwt = baseJwtBuilder()
        .claim("cognito:groups", List.of(
            "FSPTS_VIEW_ONLY_00067890",
            "FSPTS_SUBMITTER_00012345"
        ))
        .build();

    // Submitter outranks View Only; both org-suffixed groups collapse to the
    // single canonical authority.
    assertThat(authorityNames(converter.convert(jwt)))
        .containsExactly("ROLE_FSPTS_SUBMITTER");
  }

  @Test
  void emptyGroups_emitsNoAuthorities() {
    Jwt jwt = baseJwtBuilder().claim("cognito:groups", List.of()).build();

    assertThat(converter.convert(jwt)).isEmpty();
  }

  @Test
  void missingGroupsClaim_emitsNoAuthorities() {
    Jwt jwt = baseJwtBuilder().build();

    assertThat(converter.convert(jwt)).isEmpty();
  }

  private static List<String> authorityNames(Collection<GrantedAuthority> authorities) {
    return authorities.stream().map(GrantedAuthority::getAuthority).toList();
  }

  private static Jwt.Builder baseJwtBuilder() {
    return Jwt.withTokenValue("token")
        .header("alg", "RS256")
        .claim("token_use", "access")
        .issuedAt(Instant.now())
        .expiresAt(Instant.now().plusSeconds(300));
  }
}
