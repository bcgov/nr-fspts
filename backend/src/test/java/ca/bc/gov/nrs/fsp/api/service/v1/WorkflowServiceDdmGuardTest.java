package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp700WorkflowDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp800HistoryDao;
import ca.bc.gov.nrs.fsp.api.notification.EmailNotificationService;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.WorkflowRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Guards the per-action / per-role / per-status workflow fence in
 * {@link WorkflowService#submitAction} (FSPTS Permission Matrix section D,
 * client-confirmed 2026-07-06). The coarse endpoint gate (only Admin / DM /
 * Reviewer reach the endpoint) is enforced by {@code @PreAuthorize} and
 * covered in the controller test; here we verify the fine-grained rules the
 * service layers on top:
 *
 * <ul>
 *   <li>Review decisions (Reject / milestones / OTBH) are DM + Reviewer — the
 *       Administrator is excluded (Approve + Request-clarification remain).</li>
 *   <li>Extension decisions are Admin + DM — the Reviewer is excluded.</li>
 *   <li>Each action is valid only in its status window (e.g. Approve while
 *       Submitted).</li>
 * </ul>
 */
class WorkflowServiceDdmGuardTest {

  private final Fsp700WorkflowDao workflowDao = mock(Fsp700WorkflowDao.class);
  private final Fsp800HistoryDao historyDao = mock(Fsp800HistoryDao.class);
  private final FspService fspService = mock(FspService.class);
  private final EmailNotificationService emailService = mock(EmailNotificationService.class);

  private final WorkflowService service =
      new WorkflowService(workflowDao, historyDao, fspService, emailService);

  @AfterEach
  void clearAuth() {
    SecurityContextHolder.clearContext();
  }

  /** Put a JWT carrying the given cognito:groups into the security context. */
  private static void authenticateAs(String... groups) {
    Jwt jwt = Jwt.withTokenValue("token")
        .header("alg", "none")
        .claim("cognito:groups", List.of(groups))
        .build();
    SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
  }

  @Test
  void decisionMaker_isRejected_actioningWorkflowOutsideReviewPhase() {
    authenticateAs("FSPTS_DECISION_MAKER");
    // FSP is already Approved — Approve is only valid while Submitted.
    when(fspService.getById("1", "0"))
        .thenReturn(FspRequest.builder().fspStatusCode("APP").build());

    WorkflowRequest req = new WorkflowRequest();
    req.setAction("SAVE_DDM_APP");
    req.setFspAmendmentNumber("0");

    assertThatThrownBy(() -> service.submitAction("1", req))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("only valid while the plan is Submitted");

    // The proc is never reached when the guard trips.
    verifyNoInteractions(workflowDao);
  }

  @Test
  void decisionMaker_isRejected_whenStatusUnreadable() {
    // Fail-closed: if the current status can't be resolved it can't equal the
    // required SUB, so the status guard denies.
    authenticateAs("FSPTS_DECISION_MAKER");
    when(fspService.getById("1", "0")).thenReturn(null);

    WorkflowRequest req = new WorkflowRequest();
    req.setAction("SAVE_REVIEW");
    req.setFspAmendmentNumber("0");

    assertThatThrownBy(() -> service.submitAction("1", req))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("only valid while the plan is Submitted");
    verifyNoInteractions(workflowDao);
  }

  @Test
  void administrator_isRejected_fromReject() {
    // Matrix D: Reject belongs to Decision Maker + Reviewer; the Administrator
    // is excluded (Approve + Request-clarification remain available to Admin).
    // Turned away on role grounds before the proc is reached.
    authenticateAs("FSPTS_ADMINISTRATOR");
    when(fspService.getById("1", "0"))
        .thenReturn(FspRequest.builder().fspStatusCode("SUB").build());

    WorkflowRequest req = new WorkflowRequest();
    req.setAction("SAVE_DDM_REJ");
    req.setFspAmendmentNumber("0");

    assertThatThrownBy(() -> service.submitAction("1", req))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("Decision Maker or Reviewer");
    verifyNoInteractions(workflowDao);
  }

  @Test
  void reviewer_isRejected_fromExtensionDecision() {
    // Matrix D: extension decisions are Admin + Decision Maker only — a
    // Reviewer is turned away on role grounds.
    authenticateAs("FSPTS_REVIEWER");
    when(fspService.getById("1", "0"))
        .thenReturn(FspRequest.builder().fspStatusCode("INE").build());

    WorkflowRequest req = new WorkflowRequest();
    req.setAction("SAVE_EXT_APP");
    req.setFspAmendmentNumber("0");

    assertThatThrownBy(() -> service.submitAction("1", req))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("Administrator or Decision Maker");
    verifyNoInteractions(workflowDao);
  }

  @Test
  void reviewer_isRejected_savingReviewOutsideSubmitted() {
    // SAVE_REVIEW is allowed for a Reviewer, but only while Submitted.
    authenticateAs("FSPTS_REVIEWER");
    when(fspService.getById("1", "0"))
        .thenReturn(FspRequest.builder().fspStatusCode("APP").build());

    WorkflowRequest req = new WorkflowRequest();
    req.setAction("SAVE_REVIEW");
    req.setFspAmendmentNumber("0");

    assertThatThrownBy(() -> service.submitAction("1", req))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("only valid while the plan is Submitted");
    verifyNoInteractions(workflowDao);
  }
}
