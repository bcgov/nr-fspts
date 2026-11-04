package ca.bc.gov.nrs.fsp.api.security;

import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Rejects tokens that do not carry at least one FSPTS role. Roles are read
 * with {@link FamRoles#fromJwt} and may carry FAM scope suffixes (e.g.
 * {@code FSPTS_SUBMITTER_FOREST_CLIENT-00012345}); see {@link FsptsRoles}
 * for matching rules.
 */
public class FsptsRoleValidator implements OAuth2TokenValidator<Jwt> {

  private static final OAuth2Error MISSING_ROLE = new OAuth2Error(
      "insufficient_scope",
      "Token does not carry a required FSPTS role",
      null
  );

  @Override
  public OAuth2TokenValidatorResult validate(Jwt jwt) {
    for (String role : FamRoles.fromJwt(jwt)) {
      if (FsptsRoles.canonicalRoleFor(role) != null) {
        return OAuth2TokenValidatorResult.success();
      }
    }
    return OAuth2TokenValidatorResult.failure(MISSING_ROLE);
  }
}
