package ca.bc.gov.nrs.fsp.api.security;

import ca.bc.gov.nrs.fsp.api.dao.v1.StoredProcedureException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Verifies the per-FSP ownership fence: {@code user_may_access='N'}
 * (a Submitter on an FSP their org doesn't hold) is turned into a
 * 403-mapped {@code no_access_right} error, and {@code 'Y'} passes.
 */
class FspAccessGuardTest {

  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final FspAccessGuard guard = new FspAccessGuard(jdbc);

  @BeforeEach
  void authAsSubmitter() {
    Jwt jwt = Jwt.withTokenValue("token")
        .header("alg", "none")
        .claim("cognito:groups", List.of("FSPTS_SUBMITTER"))
        .build();
    SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
  }

  @AfterEach
  void clear() {
    SecurityContextHolder.clearContext();
  }

  private void stubUserMayAccess(String result) {
    // amendment is passed explicitly ("0") so only the access query runs.
    when(jdbc.queryForObject(contains("user_may_access"), eq(String.class),
        any(), any(), any(), any())).thenReturn(result);
  }

  @Test
  void deniesWriteWhenNotPermitted() {
    stubUserMayAccess("N");
    assertThatThrownBy(() -> guard.assertWritable("123", "0"))
        .isInstanceOf(StoredProcedureException.class)
        .satisfies(e -> {
          StoredProcedureException spe = (StoredProcedureException) e;
          // Carries the code ProcErrorMessages maps to HTTP 403.
          org.assertj.core.api.Assertions.assertThat(spe.getOracleErrorMessage())
              .contains("fsp.web.error.no_access_right");
        });
  }

  @Test
  void allowsWriteWhenPermitted() {
    stubUserMayAccess("Y");
    assertThatCode(() -> guard.assertWritable("123", "0")).doesNotThrowAnyException();
  }

  @Test
  void failsClosedWhenAccessCheckErrors() {
    when(jdbc.queryForObject(contains("user_may_access"), eq(String.class),
        any(), any(), any(), any()))
        .thenThrow(new DataAccessResourceFailureException("db down"));
    assertThatThrownBy(() -> guard.assertWritable("123", "0"))
        .isInstanceOf(StoredProcedureException.class);
  }

  // ── assertContentEditable: the status layer on top of the ownership fence ──

  private void authAs(String group) {
    Jwt jwt = Jwt.withTokenValue("token")
        .header("alg", "none")
        .claim("cognito:groups", List.of(group))
        .build();
    SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
  }

  private void stubStatus(String status) {
    when(jdbc.queryForObject(contains("fsp_status_code"), eq(String.class), any(), any()))
        .thenReturn(status);
  }

  @Test
  void submitterMayEditDraft() {
    stubUserMayAccess("Y"); // default auth is Submitter
    stubStatus("DFT");
    assertThatCode(() -> guard.assertContentEditable("123", "0")).doesNotThrowAnyException();
  }

  @Test
  void submitterMayNotEditApproved() {
    stubUserMayAccess("Y");
    stubStatus("APP");
    assertThatThrownBy(() -> guard.assertContentEditable("123", "0"))
        .isInstanceOf(StoredProcedureException.class)
        .satisfies(e -> {
          // Ownership is fine (user_may_access='Y'), so the denial must carry
          // the status-specific "amend it" code — NOT no_access_right, which
          // would wrongly tell the submitter it's an org/access problem.
          StoredProcedureException spe = (StoredProcedureException) e;
          org.assertj.core.api.Assertions.assertThat(spe.getOracleErrorMessage())
              .contains("fsp.web.error.not_editable_status")
              .doesNotContain("fsp.web.error.no_access_right");
        });
  }

  @Test
  void adminMayEditDraft() {
    authAs("FSPTS_ADMINISTRATOR");
    stubUserMayAccess("Y");
    stubStatus("DFT");
    assertThatCode(() -> guard.assertContentEditable("123", "0")).doesNotThrowAnyException();
  }

  @Test
  void adminMayEditApprovedInEffectAndSubmitted() {
    // Matrix B1 (client-confirmed 2026-07-06): the Administrator edits content
    // in EVERY status (previously blocked on APP / INE / SUB).
    authAs("FSPTS_ADMINISTRATOR");
    stubUserMayAccess("Y");
    for (String s : List.of("APP", "INE", "SUB")) {
      stubStatus(s);
      assertThatCode(() -> guard.assertContentEditable("123", "0"))
          .as("admin edit allowed in %s", s)
          .doesNotThrowAnyException();
    }
  }

  @Test
  void adminMayEditRejected() {
    authAs("FSPTS_ADMINISTRATOR");
    stubUserMayAccess("Y");
    stubStatus("REJ");
    assertThatCode(() -> guard.assertContentEditable("123", "0")).doesNotThrowAnyException();
  }

  @Test
  void contentEditFailsClosedWhenStatusUnreadable() {
    authAs("FSPTS_ADMINISTRATOR");
    stubUserMayAccess("Y");
    when(jdbc.queryForObject(contains("fsp_status_code"), eq(String.class), any(), any()))
        .thenThrow(new DataAccessResourceFailureException("db down"));
    assertThatThrownBy(() -> guard.assertContentEditable("123", "0"))
        .isInstanceOf(StoredProcedureException.class);
  }
}
