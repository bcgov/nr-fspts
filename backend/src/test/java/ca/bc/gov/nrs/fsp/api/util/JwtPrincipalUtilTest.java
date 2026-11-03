package ca.bc.gov.nrs.fsp.api.util;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Pins how the audit user id is built from Keycloak claims. Both rules here
 * fail silently if broken: the app keeps working and the audit columns stop
 * matching the rows written before the move.
 */
class JwtPrincipalUtilTest {

  @ParameterizedTest
  @CsvSource({"azureidir", "AZUREIDIR", "idir", "IDIR"})
  void everyIdirAliasIsWrittenAsIdir(String alias) {
    Map<String, Object> claims = Map.of(
        "identity_provider", alias,
        "idir_username", "JSMITH");

    assertThat(JwtPrincipalUtil.auditUserId(claims)).isEqualTo("IDIR\\JSMITH");
  }

  @ParameterizedTest
  @CsvSource({"bceidbusiness", "BCEIDBUSINESS", "bceidboth"})
  void bceidAliasesAreWrittenAsBceid(String alias) {
    Map<String, Object> claims = Map.of(
        "identity_provider", alias,
        "bceid_username", "some.bceid.user");

    assertThat(JwtPrincipalUtil.auditUserId(claims)).isEqualTo("BCEID\\some.bceid.user");
  }

  @Test
  void providerFallsBackToThePreferredUsernameSuffix() {
    Map<String, Object> claims = Map.of(
        "preferred_username", "0a1b2c3d4e5f@azureidir",
        "idir_username", "JSMITH");

    assertThat(JwtPrincipalUtil.auditUserId(claims)).isEqualTo("IDIR\\JSMITH");
  }

  @Test
  void lowercaseGuidIsUpperCasedWhenTheUsernameIsMissing() {
    Map<String, Object> lower = Map.of(
        "identity_provider", "azureidir",
        "idir_user_guid", "0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d");
    Map<String, Object> upper = Map.of(
        "identity_provider", "azureidir",
        "idir_user_guid", "0A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D");

    assertThat(JwtPrincipalUtil.auditUserId(lower))
        .isEqualTo("IDIR\\0A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D")
        .isEqualTo(JwtPrincipalUtil.auditUserId(upper));
  }

  @Test
  void usernameIsLeftAsIssued() {
    Map<String, Object> claims = Map.of(
        "identity_provider", "bceidbusiness",
        "bceid_username", "Mixed.Case");

    assertThat(JwtPrincipalUtil.username(claims)).isEqualTo("Mixed.Case");
  }

  @Test
  void usernameWinsOverTheGuid() {
    Map<String, Object> claims = Map.of(
        "identity_provider", "azureidir",
        "idir_username", "JSMITH",
        "idir_user_guid", "abc");

    assertThat(JwtPrincipalUtil.username(claims)).isEqualTo("JSMITH");
  }

  @Test
  void unknownProviderIsLeftUnprefixed() {
    Map<String, Object> claims = Map.of(
        "identity_provider", "github",
        "idir_username", "JSMITH");

    assertThat(JwtPrincipalUtil.auditUserId(claims)).isEqualTo("JSMITH");
  }

  @Test
  void noIdentityAtAllIsEmpty() {
    assertThat(JwtPrincipalUtil.auditUserId(new HashMap<>())).isEmpty();
    assertThat(JwtPrincipalUtil.auditUserId(null)).isEmpty();
  }
}
