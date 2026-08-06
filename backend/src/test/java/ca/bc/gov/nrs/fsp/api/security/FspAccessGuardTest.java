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

  // ── assertAttachmentEditable: the extension supporting-document carve-out ──
  //
  // A Submitter may request an extension on an Approved / In-Effect plan,
  // but B2 otherwise confines them to Draft — so the supporting letter was
  // rejected AFTER the extension request had already been created, and
  // silently dropped. These lock the carve-out's boundaries: it must open
  // for exactly the extension case and stay shut everywhere else.

  private static final String EXT_REQUEST = "EXT";
  private static final String EXT_DECISION = "EXDDMD";

  /** Stub the open-extension count (Integer.class, so it can't collide
   *  with the status stub even though both SQL strings mention
   *  fsp_status_code). */
  private void stubOpenExtensions(int count) {
    when(jdbc.queryForObject(contains("fsp_extension"), eq(Integer.class), any(), any()))
        .thenReturn(count);
  }

  @Test
  void submitterMayAttachSupportingDocWhenExtensionIsOpen() {
    stubUserMayAccess("Y"); // default auth is Submitter
    stubOpenExtensions(1);
    for (String s : List.of("APP", "INE")) {
      stubStatus(s);
      assertThatCode(() -> guard.assertAttachmentEditable("123", "0", EXT_REQUEST))
          .as("extension supporting doc allowed in %s", s)
          .doesNotThrowAnyException();
    }
  }

  @Test
  void submitterMayNotAttachSupportingDocWithoutAnOpenExtension() {
    // Same type + status, but no pending extension — the window is shut.
    stubUserMayAccess("Y");
    stubStatus("APP");
    stubOpenExtensions(0);
    assertThatThrownBy(() -> guard.assertAttachmentEditable("123", "0", EXT_REQUEST))
        .isInstanceOf(StoredProcedureException.class);
  }

  @Test
  void carveOutDoesNotExtendToOtherAttachmentTypes() {
    // An open extension must not become a general licence to attach
    // legal documents / amendment descriptions / decision letters.
    stubUserMayAccess("Y");
    stubStatus("APP");
    stubOpenExtensions(1);
    for (String type : List.of("FSP", "AMDS", "DDMD", "MAP")) {
      assertThatThrownBy(() -> guard.assertAttachmentEditable("123", "0", type))
          .as("type %s must stay blocked", type)
          .isInstanceOf(StoredProcedureException.class);
    }
  }

  @Test
  void carveOutDoesNotApplyToUntypedCallers() {
    // The two-arg overload (used by delete) passes no type, so a Submitter
    // still cannot remove attachments from an Approved plan.
    stubUserMayAccess("Y");
    stubStatus("APP");
    stubOpenExtensions(1);
    assertThatThrownBy(() -> guard.assertAttachmentEditable("123", "0"))
        .isInstanceOf(StoredProcedureException.class);
  }

  @Test
  void carveOutFailsClosedWhenExtensionLookupErrors() {
    stubUserMayAccess("Y");
    stubStatus("APP");
    when(jdbc.queryForObject(contains("fsp_extension"), eq(Integer.class), any(), any()))
        .thenThrow(new DataAccessResourceFailureException("db down"));
    assertThatThrownBy(() -> guard.assertAttachmentEditable("123", "0", EXT_REQUEST))
        .isInstanceOf(StoredProcedureException.class);
  }

  @Test
  void submitterStillMayAttachInDraftRegardlessOfType() {
    // The pre-existing B2 rule must be untouched by the carve-out.
    stubUserMayAccess("Y");
    stubStatus("DFT");
    assertThatCode(() -> guard.assertAttachmentEditable("123", "0", "FSP"))
        .doesNotThrowAnyException();
  }

  @Test
  void reviewerAndDecisionMakerRulesAreUnchanged() {
    stubUserMayAccess("Y");
    stubOpenExtensions(1);

    authAs("FSPTS_REVIEWER");
    stubStatus("SUB");
    assertThatCode(() -> guard.assertAttachmentEditable("123", "0", EXT_REQUEST))
        .doesNotThrowAnyException();
    stubStatus("APP");
    assertThatThrownBy(() -> guard.assertAttachmentEditable("123", "0", EXT_REQUEST))
        .as("reviewer gains nothing from the carve-out")
        .isInstanceOf(StoredProcedureException.class);

    authAs("FSPTS_DECISION_MAKER");
    stubStatus("OHS");
    assertThatCode(() -> guard.assertAttachmentEditable("123", "0", EXT_REQUEST))
        .doesNotThrowAnyException();
  }

  // ── EXDDMD carve-out: the Decision Maker's extension decision letter ──
  //
  // An extension decision is taken while the plan is Approved / In-Effect
  // (creating an extension never touches forest_stewardship_plan's status —
  // only fsp_extension's), which is outside a DM's SUB/OHS window. Without
  // this exemption a pure Decision Maker can't upload the letter, and
  // validate_ext_approve_reject then blocks the decision outright with
  // FSP.CANNOT.APPROVE_OR_REJECT.NO_DMD_LETTER.

  @Test
  void decisionMakerMayAttachTheDecisionLetterWhileAnExtensionIsOpen() {
    authAs("FSPTS_DECISION_MAKER");
    stubUserMayAccess("Y");
    stubOpenExtensions(1);
    for (String s : List.of("APP", "INE")) {
      stubStatus(s);
      assertThatCode(() -> guard.assertAttachmentEditable("123", "0", EXT_DECISION))
          .as("EXDDMD upload allowed in %s", s)
          .doesNotThrowAnyException();
    }
  }

  @Test
  void decisionMakerMayNotAttachTheDecisionLetterWithoutAnOpenExtension() {
    authAs("FSPTS_DECISION_MAKER");
    stubUserMayAccess("Y");
    stubStatus("APP");
    stubOpenExtensions(0);
    assertThatThrownBy(() -> guard.assertAttachmentEditable("123", "0", EXT_DECISION))
        .isInstanceOf(StoredProcedureException.class);
  }

  @Test
  void aSubmitterMayNeverFileTheDecisionOnTheirOwnExtension() {
    // The two carve-outs must not bleed into each other: EXDDMD is the
    // document that decides the request, and the requester must not be
    // able to file it.
    stubUserMayAccess("Y"); // default auth is Submitter
    stubStatus("APP");
    stubOpenExtensions(1);
    assertThatThrownBy(() -> guard.assertAttachmentEditable("123", "0", EXT_DECISION))
        .isInstanceOf(StoredProcedureException.class);
  }

  @Test
  void aDecisionMakerGainsNothingForTheRequestLetter() {
    // Converse of the above — EXT is the Submitter's document.
    authAs("FSPTS_DECISION_MAKER");
    stubUserMayAccess("Y");
    stubStatus("APP");
    stubOpenExtensions(1);
    assertThatThrownBy(() -> guard.assertAttachmentEditable("123", "0", EXT_REQUEST))
        .isInstanceOf(StoredProcedureException.class);
  }

  @Test
  void theExddmdCarveOutDoesNotWidenOtherTypesForDecisionMakers() {
    authAs("FSPTS_DECISION_MAKER");
    stubUserMayAccess("Y");
    stubStatus("APP");
    stubOpenExtensions(1);
    for (String type : List.of("FSP", "AMDS", "DDMD", "MAP", "OTHR")) {
      assertThatThrownBy(() -> guard.assertAttachmentEditable("123", "0", type))
          .as("type %s must stay blocked on an APP plan", type)
          .isInstanceOf(StoredProcedureException.class);
    }
  }

  @Test
  void reviewerGainsNothingFromTheExddmdCarveOut() {
    authAs("FSPTS_REVIEWER");
    stubUserMayAccess("Y");
    stubStatus("APP");
    stubOpenExtensions(1);
    assertThatThrownBy(() -> guard.assertAttachmentEditable("123", "0", EXT_DECISION))
        .isInstanceOf(StoredProcedureException.class);
  }

  @Test
  void theExddmdCarveOutFailsClosedWhenTheExtensionLookupErrors() {
    authAs("FSPTS_DECISION_MAKER");
    stubUserMayAccess("Y");
    stubStatus("APP");
    when(jdbc.queryForObject(contains("fsp_extension"), eq(Integer.class), any(), any()))
        .thenThrow(new DataAccessResourceFailureException("db down"));
    assertThatThrownBy(() -> guard.assertAttachmentEditable("123", "0", EXT_DECISION))
        .isInstanceOf(StoredProcedureException.class);
  }
}
