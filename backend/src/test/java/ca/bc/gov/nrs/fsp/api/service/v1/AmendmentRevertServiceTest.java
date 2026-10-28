package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.AmendmentRevertDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.AmendmentRevertDao.AmendmentRow;
import ca.bc.gov.nrs.fsp.api.dao.v1.AmendmentRevertDao.LinkedStandard;
import ca.bc.gov.nrs.fsp.api.dao.v1.AmendmentRevertDao.ProcError;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp901NotificationBatchDao;
import ca.bc.gov.nrs.fsp.api.exception.ConflictFoundException;
import ca.bc.gov.nrs.fsp.api.notification.EmailNotificationService;
import ca.bc.gov.nrs.fsp.api.notification.WorkflowEmailEvent;
import ca.bc.gov.nrs.fsp.api.struct.v1.AmendmentRevertResponse;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.util.ReflectionTestUtils;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AmendmentRevertServiceTest {

  private static final Timestamp SUBMITTED = Timestamp.valueOf("2026-03-02 00:00:00");

  private final AmendmentRevertDao dao = mock(AmendmentRevertDao.class);
  private final Fsp901NotificationBatchDao batchDao = mock(Fsp901NotificationBatchDao.class);
  private final FspService fspService = mock(FspService.class);
  private final EmailNotificationService emailService = mock(EmailNotificationService.class);

  private final AmendmentRevertService service =
      new AmendmentRevertService(dao, batchDao, fspService, emailService);

  @BeforeEach
  void setUp() {
    authenticateAs("FSPTS_ADMINISTRATOR");
    ReflectionTestUtils.setField(service, "standardsInbox", "standards@example.com");
    when(fspService.getById("969", "3")).thenReturn(
        FspRequest.builder().fspId("969").fspAmendmentNumber("3")
            .fspEmailAddress("contact@example.com").build());
  }

  @AfterEach
  void clearAuth() {
    SecurityContextHolder.clearContext();
  }

  private static void authenticateAs(String... groups) {
    Jwt jwt = Jwt.withTokenValue("token")
        .header("alg", "none")
        .claim("cognito:groups", List.of(groups))
        .build();
    SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt));
  }

  /** Amendment 3 starts in {@code before}; after the proc call it reads {@code after}. */
  private void amendment(String before, String after, String code) {
    when(dao.findAmendment(969L, 3L)).thenReturn(
        Optional.of(new AmendmentRow(before, code, SUBMITTED)),
        Optional.of(new AmendmentRow(after, code, SUBMITTED)));
    when(dao.updateStatus(anyLong(), anyLong(), anyString(), anyString(), any()))
        .thenReturn(List.of());
  }

  @Test
  void approved_goesBackToSubmitted_keepsSubmissionDate_andSuppressesDesignateEmail() {
    amendment("APP", "SUB", "AMD");
    when(dao.findNonDefaultStandards(969L, 3L)).thenReturn(List.of(
        new LinkedStandard(1001L, "Spruce", "APP"),
        new LinkedStandard(1002L, "Pine", "APP")));
    when(dao.findLatestHistoryId(969L, 3L, "SUB")).thenReturn(555L);

    AmendmentRevertResponse res = service.revert("969", "3", "  Approved in error  ");

    assertThat(res.previousStatusCode()).isEqualTo("APP");
    assertThat(res.newStatusCode()).isEqualTo("SUB");
    assertThat(res.standardsKeptApproved()).isEqualTo(2);
    verify(dao).updateStatus(eq(969L), eq(3L), eq("SUB"),
        contains("Reason: Approved in error"), any());
    verify(dao).setStandardStatus(1001L, "APP");
    verify(dao).setStandardStatus(1002L, "APP");
    verify(dao).clearApprovalFields(eq(969L), eq(3L), eq(SUBMITTED), any());
    verify(batchDao).change("969", "3", "555");

    ArgumentCaptor<WorkflowEmailEvent> events = ArgumentCaptor.forClass(WorkflowEmailEvent.class);
    verify(emailService, times(2)).publish(events.capture());
    assertThat(events.getAllValues().get(0))
        .isInstanceOf(WorkflowEmailEvent.AmendmentReverted.class);
    WorkflowEmailEvent.RevertedStandardsNotice notice =
        (WorkflowEmailEvent.RevertedStandardsNotice) events.getAllValues().get(1);
    assertThat(notice.recipient()).isEqualTo("standards@example.com");
    assertThat(notice.standards()).contains("SSID 1001 - Spruce").contains("SSID 1002 - Pine");
  }

  @Test
  void inEffect_goesBackToDraft_andClearsSubmissionDate() {
    amendment("INE", "DFT", "AMD");
    when(dao.findNonDefaultStandards(969L, 3L)).thenReturn(List.of());

    AmendmentRevertResponse res = service.revert("969", "3", "Wrong FDUs");

    assertThat(res.newStatusCode()).isEqualTo("DFT");
    verify(dao).updateStatus(eq(969L), eq(3L), eq("DFT"), anyString(), any());
    verify(dao).clearApprovalFields(eq(969L), eq(3L), isNull(), any());
    verifyNoInteractions(batchDao);
    // Contact notice only; no standards to report.
    verify(emailService, times(1)).publish(any(WorkflowEmailEvent.AmendmentReverted.class));
  }

  @Test
  void noStandardsInbox_skipsStandardsNoticeOnly() {
    ReflectionTestUtils.setField(service, "standardsInbox", "");
    amendment("INE", "DFT", "AMD");
    when(dao.findNonDefaultStandards(969L, 3L))
        .thenReturn(List.of(new LinkedStandard(1001L, "Spruce", "APP")));

    service.revert("969", "3", "Wrong FDUs");

    verify(emailService, times(1)).publish(any(WorkflowEmailEvent.AmendmentReverted.class));
  }

  @Test
  void procErrors_abortTheRevert() {
    when(dao.findAmendment(969L, 3L))
        .thenReturn(Optional.of(new AmendmentRow("APP", "AMD", SUBMITTED)));
    when(dao.updateStatus(anyLong(), anyLong(), anyString(), anyString(), any()))
        .thenReturn(List.of(new ProcError("FSP.SOME.RULE", "Licence has expired")));

    assertThatThrownBy(() -> service.revert("969", "3", "reason"))
        .isInstanceOf(ConflictFoundException.class)
        .hasMessageContaining("Licence has expired");
    verify(dao, never()).clearApprovalFields(anyLong(), anyLong(), any(), any());
    verifyNoInteractions(batchDao, emailService);
  }

  @Test
  void original_isRefused() {
    assertThatThrownBy(() -> service.revert("969", "0", "reason"))
        .isInstanceOf(ConflictFoundException.class)
        .hasMessageContaining("original");
    verifyNoInteractions(dao);
  }

  @Test
  void replacement_isRefused() {
    when(dao.findAmendment(969L, 3L))
        .thenReturn(Optional.of(new AmendmentRow("APP", "RPL", SUBMITTED)));
    assertThatThrownBy(() -> service.revert("969", "3", "reason"))
        .isInstanceOf(ConflictFoundException.class)
        .hasMessageContaining("replacement");
    verify(dao, never()).updateStatus(anyLong(), anyLong(), anyString(), anyString(), any());
  }

  @Test
  void notApprovedOrInEffect_isRefused() {
    when(dao.findAmendment(969L, 3L))
        .thenReturn(Optional.of(new AmendmentRow("SUB", "AMD", SUBMITTED)));
    assertThatThrownBy(() -> service.revert("969", "3", "reason"))
        .isInstanceOf(ConflictFoundException.class);
    verify(dao, never()).updateStatus(anyLong(), anyLong(), anyString(), anyString(), any());
  }

  @Test
  void laterAmendment_isRefused() {
    when(dao.findAmendment(969L, 3L))
        .thenReturn(Optional.of(new AmendmentRow("APP", "AMD", SUBMITTED)));
    when(dao.countLaterLiveAmendments(969L, 3L)).thenReturn(1);
    assertThatThrownBy(() -> service.revert("969", "3", "reason"))
        .isInstanceOf(ConflictFoundException.class)
        .hasMessageContaining("most recent");
    verify(dao, never()).updateStatus(anyLong(), anyLong(), anyString(), anyString(), any());
  }

  @Test
  void attachedExtension_isRefused() {
    when(dao.findAmendment(969L, 3L))
        .thenReturn(Optional.of(new AmendmentRow("APP", "AMD", SUBMITTED)));
    when(dao.countExtensionsOnAmendment(969L, 3L)).thenReturn(1);
    assertThatThrownBy(() -> service.revert("969", "3", "reason"))
        .isInstanceOf(ConflictFoundException.class)
        .hasMessageContaining("extension");
    verify(dao, never()).updateStatus(anyLong(), anyLong(), anyString(), anyString(), any());
  }

  @Test
  void blankReason_isRefused() {
    assertThatThrownBy(() -> service.revert("969", "3", "   "))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("reason");
    verifyNoInteractions(dao);
  }

  @Test
  void nonAdmin_isRefused() {
    authenticateAs("FSPTS_DECISION_MAKER");
    assertThatThrownBy(() -> service.revert("969", "3", "reason"))
        .isInstanceOf(AccessDeniedException.class);
    verifyNoInteractions(dao);
  }
}
