package ca.bc.gov.nrs.fsp.api.security;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Pins FAM's role-name grammar (ported from {@code CssRoleNaming.parse} in
 * nr-fam) and where the roles are read from on the token.
 */
class FamRolesTest {

  @ParameterizedTest
  @CsvSource({
      "FSPTS_SUBMITTER_FOREST_CLIENT-00012345, FSPTS_SUBMITTER, FOREST_CLIENT, 00012345",
      "FSPTS_DECISION_MAKER_DISTRICT-DCC,      FSPTS_DECISION_MAKER, DISTRICT, DCC",
      "FSPTS_VIEW_ALL_REGION-KOOTENAY_BOUNDARY, FSPTS_VIEW_ALL, REGION, KOOTENAY_BOUNDARY",
  })
  void parsesOneScope(String name, String base, String type, String value) {
    FamRoles.Parsed parsed = FamRoles.parse(name);

    assertThat(parsed.baseRole()).isEqualTo(base);
    assertThat(parsed.scopes()).containsExactly(new FamRoles.Scope(type, value));
  }

  @Test
  void forestClientIsNotReadAsAClientScopeOnAForestBase() {
    // Splitting on the last underscore would give base FSPTS_SUBMITTER_FOREST.
    FamRoles.Parsed parsed = FamRoles.parse("FSPTS_SUBMITTER_FOREST_CLIENT-00012345");

    assertThat(parsed.baseRole()).isEqualTo("FSPTS_SUBMITTER");
    assertThat(parsed.scopeValue(FamRoles.SCOPE_FOREST_CLIENT)).isEqualTo("00012345");
  }

  @Test
  void parsesChainedScopesInWrittenOrder() {
    FamRoles.Parsed parsed =
        FamRoles.parse("FSPTS_SUBMITTER_DISTRICT-DCC_FOREST_CLIENT-00012345");

    assertThat(parsed.baseRole()).isEqualTo("FSPTS_SUBMITTER");
    assertThat(parsed.scopes()).containsExactly(
        new FamRoles.Scope("DISTRICT", "DCC"),
        new FamRoles.Scope("FOREST_CLIENT", "00012345"));
  }

  @ParameterizedTest
  @CsvSource({"FSPTS_ADMINISTRATOR", "FSPTS_ADMINISTRATOR_DPG", "SOME-ROLE"})
  void leavesUnscopedNamesAlone(String name) {
    FamRoles.Parsed parsed = FamRoles.parse(name);

    assertThat(parsed.baseRole()).isEqualTo(name);
    assertThat(parsed.scopes()).isEmpty();
  }

  @Test
  void canonicalRoleAndClientNumberComeFromTheParsedName() {
    assertThat(FsptsRoles.canonicalRoleFor("FSPTS_SUBMITTER_FOREST_CLIENT-00012345"))
        .isEqualTo(FsptsRoles.SUBMITTER);
    assertThat(FsptsRoles.clientNumberFor("FSPTS_SUBMITTER_FOREST_CLIENT-00012345"))
        .isEqualTo("00012345");
    // Organisation-named roles carried over from the old FAM still canonicalise.
    assertThat(FsptsRoles.canonicalRoleFor("FSPTS_ADMINISTRATOR_DPG"))
        .isEqualTo(FsptsRoles.ADMINISTRATOR);
    assertThat(FsptsRoles.clientNumberFor("FSPTS_ADMINISTRATOR_DPG")).isNull();
    // A client scope on some other application's role is not ours.
    assertThat(FsptsRoles.clientNumberFor("FOM_SUBMITTER_FOREST_CLIENT-00012345")).isNull();
    // The Cognito-era spelling is no longer a client scope.
    assertThat(FsptsRoles.clientNumberFor("FSPTS_SUBMITTER_00012345")).isNull();
  }

  @Test
  void readsClientRolesAndDropsFamSidecars() {
    Jwt jwt = jwt()
        .claim("client_roles", List.of(
            "FSPTS_SUBMITTER_FOREST_CLIENT-00012345",
            "FAM:EXPIRES:2026-09-30:FSPTS_SUBMITTER_FOREST_CLIENT-00012345"))
        .build();

    assertThat(FamRoles.fromJwt(jwt)).containsExactly("FSPTS_SUBMITTER_FOREST_CLIENT-00012345");
  }

  @Test
  void fallsBackToResourceAccessForTheAuthorizedParty() {
    Jwt jwt = jwt()
        .claim("azp", "fsp-client")
        .claim("resource_access", Map.of(
            "fsp-client", Map.of("roles", List.of("FSPTS_REVIEWER")),
            "other-client", Map.of("roles", List.of("FSPTS_ADMINISTRATOR"))))
        .build();

    assertThat(FamRoles.fromJwt(jwt)).containsExactly("FSPTS_REVIEWER");
  }

  @Test
  void noRolesAnywhereIsAnEmptyList() {
    assertThat(FamRoles.fromJwt(jwt().claim("sub", "x").build())).isEmpty();
  }

  private static Jwt.Builder jwt() {
    return Jwt.withTokenValue("token")
        .header("alg", "RS256")
        .issuedAt(Instant.now())
        .expiresAt(Instant.now().plusSeconds(300));
  }
}
