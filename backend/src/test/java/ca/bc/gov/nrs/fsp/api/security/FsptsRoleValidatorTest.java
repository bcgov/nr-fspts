package ca.bc.gov.nrs.fsp.api.security;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class FsptsRoleValidatorTest {

  private final FsptsRoleValidator validator = new FsptsRoleValidator();

  @Test
  void canonicalRole_passes() {
    Jwt jwt = baseJwtBuilder()
        .claim("client_roles", List.of("FSPTS_ADMINISTRATOR"))
        .build();

    assertThat(validator.validate(jwt).hasErrors()).isFalse();
  }

  @Test
  void orgSuffixedRole_passes() {
    Jwt jwt = baseJwtBuilder()
        .claim("client_roles", List.of("FSPTS_ADMINISTRATOR_DPG"))
        .build();

    assertThat(validator.validate(jwt).hasErrors()).isFalse();
  }

  @Test
  void anyOneMatchingRoleAmongMany_passes() {
    Jwt jwt = baseJwtBuilder()
        .claim("client_roles", List.of("UNRELATED_GROUP", "FSPTS_VIEW_ONLY_DSE"))
        .build();

    assertThat(validator.validate(jwt).hasErrors()).isFalse();
  }

  @Test
  void noFsptsGroup_fails() {
    Jwt jwt = baseJwtBuilder()
        .claim("client_roles", List.of("UNRELATED_GROUP", "ANOTHER_GROUP"))
        .build();

    OAuth2TokenValidatorResult result = validator.validate(jwt);

    assertThat(result.hasErrors()).isTrue();
    assertThat(result.getErrors()).anySatisfy(err ->
        assertThat(err.getDescription()).contains("FSPTS role")
    );
  }

  @Test
  void emptyGroups_fails() {
    Jwt jwt = baseJwtBuilder().claim("client_roles", List.of()).build();

    assertThat(validator.validate(jwt).hasErrors()).isTrue();
  }

  @Test
  void missingGroupsClaim_fails() {
    Jwt jwt = baseJwtBuilder().build();

    assertThat(validator.validate(jwt).hasErrors()).isTrue();
  }

  @Test
  void prefixThatIsNotFollowedByUnderscore_fails() {
    // "FSPTS_ADMIN" is a prefix of "FSPTS_ADMINISTRATOR" but is not the canonical
    // role and is not followed by '_', so it must not satisfy the validator.
    Jwt jwt = baseJwtBuilder()
        .claim("client_roles", List.of("FSPTS_ADMIN"))
        .build();

    assertThat(validator.validate(jwt).hasErrors()).isTrue();
  }

  @Test
  void forestClientScopedRole_passes() {
    Jwt jwt = baseJwtBuilder()
        .claim("client_roles", List.of("FSPTS_SUBMITTER_FOREST_CLIENT-00012345"))
        .build();

    assertThat(validator.validate(jwt).hasErrors()).isFalse();
  }

  @Test
  void onlyAFamSidecar_fails() {
    Jwt jwt = baseJwtBuilder()
        .claim("client_roles", List.of("FAM:EXPIRES:2026-09-30:FSPTS_ADMINISTRATOR"))
        .build();

    assertThat(validator.validate(jwt).hasErrors()).isTrue();
  }

  private static Jwt.Builder baseJwtBuilder() {
    return Jwt.withTokenValue("token")
        .header("alg", "RS256")
        .issuedAt(Instant.now())
        .expiresAt(Instant.now().plusSeconds(300));
  }
}
