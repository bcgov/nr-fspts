package ca.bc.gov.nrs.fsp.api.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Refuses a token our realm minted for some other application.
 *
 * <p>The BC Gov SSO standard realm is shared by many applications. Their tokens
 * are all signed by the same issuer and verify against the same keys, so
 * signature and issuer checks alone don't show a token was meant for FSP. This
 * compares the {@code azp} (authorized party) claim with FSP's own CSS client id.
 *
 * <p>It replaces the Cognito-era {@code token_use == "access"} check. Keycloak
 * doesn't emit {@code token_use}, so keeping that check would refuse every
 * request.
 *
 * <p>The error returned to the caller doesn't name either client id; the
 * mismatch is logged for operators instead.
 */
public class AuthorizedPartyValidator implements OAuth2TokenValidator<Jwt> {

  private static final Logger LOGGER = LoggerFactory.getLogger(AuthorizedPartyValidator.class);

  private static final OAuth2Error WRONG_CLIENT = new OAuth2Error(
      "invalid_token",
      "This token was not issued to this application.",
      null
  );

  private final String expectedClientId;

  public AuthorizedPartyValidator(String expectedClientId) {
    if (expectedClientId == null || expectedClientId.isBlank()) {
      // A blank id would make every token from the realm acceptable.
      throw new IllegalStateException(
          "fsp.keycloak.client-id (KEYCLOAK_CLIENT_ID) must be set.");
    }
    this.expectedClientId = expectedClientId.trim();
  }

  @Override
  public OAuth2TokenValidatorResult validate(Jwt jwt) {
    String azp = jwt.getClaimAsString("azp");
    if (expectedClientId.equals(azp)) {
      return OAuth2TokenValidatorResult.success();
    }
    LOGGER.warn("Rejected a token issued to client '{}'; this API accepts only '{}'.",
        azp, expectedClientId);
    return OAuth2TokenValidatorResult.failure(WRONG_CLIENT);
  }
}
