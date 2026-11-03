package ca.bc.gov.nrs.fsp.api.util;

import ca.bc.gov.nrs.fsp.api.security.FsptsRoles;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Client-tied roles under FAM: the forest client is the role's
 * {@code _FOREST_CLIENT-<number>} scope, and the active-org header picks which
 * of the user's clients (and so which role) applies to the request.
 */
class RequestUtilRolesTest {

  private static final String HEADER = "X-FSPTS-Active-Org-Client-Number";

  @AfterEach
  void clear() {
    SecurityContextHolder.clearContext();
    RequestContextHolder.resetRequestAttributes();
  }

  @Test
  void activeOrgHeaderSelectsTheRoleHeldForThatClient() {
    authenticate("FSPTS_SUBMITTER_FOREST_CLIENT-00012345",
        "FSPTS_VIEW_ONLY_FOREST_CLIENT-00067890");

    activeOrg("00067890");
    assertThat(RequestUtil.getCurrentClientNumber()).isEqualTo("00067890");
    assertThat(RequestUtil.getEffectiveRole()).isEqualTo(FsptsRoles.VIEW_ONLY);
    assertThat(RequestUtil.getCurrentLegacyRoles()).isEqualTo("FSP_VIEW_ONLY,");

    activeOrg("00012345");
    assertThat(RequestUtil.getCurrentClientNumber()).isEqualTo("00012345");
    assertThat(RequestUtil.getEffectiveRole()).isEqualTo(FsptsRoles.SUBMITTER);
  }

  @Test
  void headerForAClientTheUserDoesNotHoldIsIgnored() {
    authenticate("FSPTS_SUBMITTER_FOREST_CLIENT-00012345");

    activeOrg("99999999");
    assertThat(RequestUtil.getCurrentClientNumber()).isEqualTo("00012345");
  }

  @Test
  void famSidecarDoesNotAddAClient() {
    authenticate("FSPTS_SUBMITTER_FOREST_CLIENT-00012345",
        "FAM:EXPIRES:2026-09-30:FSPTS_SUBMITTER_FOREST_CLIENT-00067890");

    activeOrg("00067890");
    assertThat(RequestUtil.getCurrentClientNumber()).isEqualTo("00012345");
  }

  @Test
  void internalRoleHasNoClientAndWins() {
    authenticate("FSPTS_REVIEWER");

    assertThat(RequestUtil.getCurrentClientNumber()).isEmpty();
    assertThat(RequestUtil.getEffectiveRole()).isEqualTo(FsptsRoles.REVIEWER);
  }

  @Test
  void auditUserIdIsBuiltFromKeycloakClaims() {
    Jwt jwt = Jwt.withTokenValue("token")
        .header("alg", "none")
        .claim("identity_provider", "azureidir")
        .claim("idir_username", "JSMITH")
        .claim("client_roles", List.of("FSPTS_ADMINISTRATOR"))
        .build();
    SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));

    assertThat(RequestUtil.getCurrentAuditUserId()).isEqualTo("IDIR\\JSMITH");
    assertThat(RequestUtil.getCurrentIdir()).isEqualTo("JSMITH");
  }

  private static void authenticate(String... roles) {
    Jwt jwt = Jwt.withTokenValue("token")
        .header("alg", "none")
        .claim("client_roles", List.of(roles))
        .build();
    SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
  }

  private static void activeOrg(String clientNumber) {
    MockHttpServletRequest request = new MockHttpServletRequest();
    request.addHeader(HEADER, clientNumber);
    RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
  }
}
