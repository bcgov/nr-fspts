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
 * Guards the "Decision Makers act only during the review phase" rule in
 * {@link WorkflowService#submitAction}. The role gate (only Admin / DDM
 * reach the endpoint) is enforced by {@code @PreAuthorize} and covered in
 * the controller test; here we verify the status constraint the service
 * layers on top for non-admin Decision Makers.
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
    // FSP is already Approved — outside the SUB/OHS review phase.
    when(fspService.getById("1", "0"))
        .thenReturn(FspRequest.builder().fspStatusCode("APP").build());

    WorkflowRequest req = new WorkflowRequest();
    req.setAction("SAVE_DDM_APP");
    req.setFspAmendmentNumber("0");

    assertThatThrownBy(() -> service.submitAction("1", req))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("under review");

    // The proc is never reached when the guard trips.
    verifyNoInteractions(workflowDao);
  }

  @Test
  void decisionMaker_isRejected_whenStatusUnreadable() {
    // Fail-closed: if the current status can't be resolved, deny.
    authenticateAs("FSPTS_DECISION_MAKER");
    when(fspService.getById("1", "0")).thenReturn(null);

    WorkflowRequest req = new WorkflowRequest();
    req.setAction("SAVE_REVIEW");
    req.setFspAmendmentNumber("0");

    assertThatThrownBy(() -> service.submitAction("1", req))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("under review");
    verifyNoInteractions(workflowDao);
  }

  @Test
  void reviewer_isRejected_submittingADecision() {
    // A Reviewer may record review milestones only — never a decision. The
    // action is checked before the status is even read.
    authenticateAs("FSPTS_REVIEWER");

    WorkflowRequest req = new WorkflowRequest();
    req.setAction("SAVE_DDM_APP");
    req.setFspAmendmentNumber("0");

    assertThatThrownBy(() -> service.submitAction("1", req))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("review milestones");
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
        .hasMessageContaining("under review");
    verifyNoInteractions(workflowDao);
  }
}
