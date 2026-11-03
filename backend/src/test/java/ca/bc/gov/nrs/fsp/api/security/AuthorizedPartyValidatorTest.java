package ca.bc.gov.nrs.fsp.api.security;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AuthorizedPartyValidatorTest {

  private final AuthorizedPartyValidator validator = new AuthorizedPartyValidator("fsp-client");

  @Test
  void tokenIssuedToFsp_passes() {
    assertThat(validator.validate(jwtWithAzp("fsp-client")).hasErrors()).isFalse();
  }

  @Test
  void tokenIssuedToAnotherAppOnTheSameRealm_fails() {
    OAuth2TokenValidatorResult result = validator.validate(jwtWithAzp("some-other-app"));

    assertThat(result.hasErrors()).isTrue();
    // The caller isn't told which client this API expects.
    assertThat(result.getErrors()).allSatisfy(err ->
        assertThat(err.getDescription()).doesNotContain("fsp-client"));
  }

  @Test
  void tokenWithNoAzp_fails() {
    Jwt jwt = Jwt.withTokenValue("t").header("alg", "RS256").claim("sub", "x")
        .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).build();

    assertThat(validator.validate(jwt).hasErrors()).isTrue();
  }

  @Test
  void keycloakTokenWithoutTokenUse_passes() {
    // The Cognito-era check required token_use=access; Keycloak never sends it.
    assertThat(validator.validate(jwtWithAzp("fsp-client")).hasErrors()).isFalse();
  }

  @Test
  void blankClientIdRefusesToStart() {
    assertThatThrownBy(() -> new AuthorizedPartyValidator(" "))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> new AuthorizedPartyValidator(null))
        .isInstanceOf(IllegalStateException.class);
  }

  private static Jwt jwtWithAzp(String azp) {
    return Jwt.withTokenValue("t")
        .header("alg", "RS256")
        .claim("azp", azp)
        .issuedAt(Instant.now())
        .expiresAt(Instant.now().plusSeconds(60))
        .build();
  }
}
