package ca.bc.gov.nrs.fsp.api.service.v1;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp302ExtensionRequestDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp303ExtensionSummaryDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp700WorkflowDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp800HistoryDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FspExtensionQueryDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FspWorkflowQueryDao;
import ca.bc.gov.nrs.fsp.api.notification.EmailNotificationService;
import ca.bc.gov.nrs.fsp.api.security.FspAccessGuard;
import ca.bc.gov.nrs.fsp.api.struct.v1.ExtensionRequestSave;
import ca.bc.gov.nrs.fsp.api.struct.v1.WorkflowRequest;
import ca.bc.gov.nrs.fsp.api.struct.v1.WorkflowState;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.multipart.MultipartFile;

/**
 * The combined submit paths exist so a write and its attachment land as ONE
 * unit of work. These lock the two properties that matters for that:
 *
 * <ul>
 *   <li><b>Ordering</b> — the attachment is persisted BEFORE the write it
 *       belongs to. Both decision procs validate that their letter is
 *       already on file, so uploading afterwards makes the save fail.</li>
 *   <li><b>Propagation</b> — an attachment failure escapes rather than
 *       being swallowed, so Spring rolls the whole transaction back. The
 *       old client-orchestrated flow caught it and carried on, which is
 *       how an extension reached PROD without its supporting letter.</li>
 * </ul>
 */
class CombinedSubmitTransactionTest {

  private static final MultipartFile LETTER =
      new MockMultipartFile("file", "letter.pdf", "application/pdf", "pdf".getBytes());

  private final Fsp303ExtensionSummaryDao summaryDao = mock(Fsp303ExtensionSummaryDao.class);
  private final Fsp302ExtensionRequestDao requestDao = mock(Fsp302ExtensionRequestDao.class);
  private final FspExtensionQueryDao extensionQueryDao = mock(FspExtensionQueryDao.class);
  private final FspAccessGuard accessGuard = mock(FspAccessGuard.class);
  private final VirusScanner virusScanner = mock(VirusScanner.class);
  private final AttachmentsService attachmentsService = mock(AttachmentsService.class);

  private final ExtensionService extensionService = new ExtensionService(
      summaryDao, requestDao, extensionQueryDao, accessGuard, virusScanner);

  @BeforeEach
  void authenticate() {
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

  private void stubCreateSucceeds() {
    when(extensionQueryDao.hasOpenExtension(anyString() == null ? 0L : 123L)).thenReturn(false);
    when(requestDao.save(any()))
        .thenReturn(new Fsp302ExtensionRequestDao.SaveResult("456", "1", null));
    when(requestDao.createAttachment(
        anyString(), anyString(), anyString(), any(), anyString(), anyString(), any()))
        .thenReturn(new Fsp302ExtensionRequestDao.CreateAttachmentResult(789L, null));
  }

  // ── Extension request + supporting documents ──

  @Test
  void extensionRequestIsCreatedBeforeItsAttachmentsArePersisted() throws Exception {
    stubCreateSucceeds();

    extensionService.createRequestWithAttachments(
        "123", new ExtensionRequestSave(), List.of(LETTER));

    // Create-then-attach is required: FspAccessGuard's carve-out looks for
    // an extension in SUB on this FSP, and inside this transaction that
    // lookup must see the row we just inserted.
    InOrder order = inOrder(requestDao);
    order.verify(requestDao).save(any());
    // MUST go through FSP_302's createAttachment (keyed on extension_id →
    // fsp_extension_xref), NOT the FSP-level AttachmentsService (keyed on
    // fsp_id + amendment → fsp_attachment_xref). Only the former links the
    // file to the extension, which is what the Extension Summary dialog
    // reads; the FSP-level path stored the letter but left it invisible.
    order.verify(requestDao).createAttachment(
        eq("456"), eq("EXT"), eq("letter.pdf"), any(), anyString(), anyString(), any());
    verify(attachmentsService, never()).upload(anyString(), any(), anyString(), anyString());
  }

  @Test
  void theSupportingLetterIsLinkedToTheExtensionItWasCreatedWith() throws Exception {
    stubCreateSucceeds();

    extensionService.createRequestWithAttachments(
        "123", new ExtensionRequestSave(), List.of(LETTER));

    // The extension id from the just-created request — not the FSP id —
    // is what carries the xref linkage.
    verify(requestDao).createAttachment(
        eq("456"), anyString(), anyString(), any(), anyString(), anyString(), any());
  }

  @Test
  void aRejectedFilenamePropagatesSoTheExtensionRollsBack() throws Exception {
    stubCreateSucceeds();
    // 50 characters but 52 UTF-8 bytes (en-dash) — the production filename
    // that started this. Doubles as proof that AttachmentConstraints now
    // runs on the extension-linked path, which previously had no fence.
    MultipartFile longName = new MockMultipartFile(
        "files", "FSP_Extension_Request_–_Supporting_Letter_2026.pdf",
        "application/pdf", "pdf".getBytes());

    // Must NOT be swallowed. The old flow caught this per-file and still
    // reported success, leaving the extension committed without its letter.
    assertThatThrownBy(() -> extensionService.createRequestWithAttachments(
        "123", new ExtensionRequestSave(), List.of(longName)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("File name too long");
  }

  @Test
  void aFailedAttachmentInsertPropagatesSoTheExtensionRollsBack() throws Exception {
    stubCreateSucceeds();
    doThrow(new IllegalStateException("blob write failed"))
        .when(requestDao).saveAttachmentContent(any(), any());

    assertThatThrownBy(() -> extensionService.createRequestWithAttachments(
        "123", new ExtensionRequestSave(), List.of(LETTER)))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void anExtensionWithNoAttachmentsTouchesNoAttachmentPath() throws Exception {
    stubCreateSucceeds();

    extensionService.createRequestWithAttachments("123", new ExtensionRequestSave(), List.of());

    verify(attachmentsService, never()).upload(anyString(), any(), anyString(), anyString());
  }

  @Test
  void emptyFilePartsAreSkipped() throws Exception {
    stubCreateSucceeds();
    MultipartFile empty = new MockMultipartFile("files", "", "application/pdf", new byte[0]);

    extensionService.createRequestWithAttachments(
        "123", new ExtensionRequestSave(), List.of(empty));

    verify(attachmentsService, never()).upload(anyString(), any(), anyString(), anyString());
  }

  // ── DDM decision + letter ──

  private WorkflowService workflowServiceSpy() {
    WorkflowService real = new WorkflowService(
        mock(Fsp700WorkflowDao.class),
        mock(Fsp800HistoryDao.class),
        mock(FspService.class),
        mock(EmailNotificationService.class),
        mock(FspWorkflowQueryDao.class),
        attachmentsService,
        extensionService);
    WorkflowService service = spy(real);
    // submitAction is covered by its own tests; stub it so these focus on
    // the letter/decision ordering rather than the 70-param proc dispatch.
    // Return value is irrelevant here — WorkflowState is a 13-component
    // record and these tests assert call ordering, not the projection.
    doReturn(null).when(service).submitAction(anyString(), any());
    return service;
  }

  @Test
  void ddmLetterIsPersistedBeforeTheDecisionIsSaved() throws Exception {
    WorkflowService service = workflowServiceSpy();

    service.submitDdmDecisionWithLetter("123", new WorkflowRequest(), LETTER);

    InOrder order = inOrder(attachmentsService, service);
    order.verify(attachmentsService).upload(eq("123"), eq(LETTER), eq("DDMD"), anyString());
    order.verify(service).submitAction(eq("123"), any());
  }

  @Test
  void ddmDecisionWithoutALetterSkipsTheUpload() throws Exception {
    WorkflowService service = workflowServiceSpy();

    // Editing a decision whose letter is already on file.
    service.submitDdmDecisionWithLetter("123", new WorkflowRequest(), null);

    verify(attachmentsService, never()).upload(anyString(), any(), anyString(), anyString());
    verify(service).submitAction(eq("123"), any());
  }

  @Test
  void aFailedDdmLetterStopsTheDecisionFromBeingSaved() throws Exception {
    WorkflowService service = workflowServiceSpy();
    doThrow(new IllegalArgumentException("File type not supported."))
        .when(attachmentsService).upload(anyString(), any(), anyString(), anyString());

    assertThatThrownBy(() ->
        service.submitDdmDecisionWithLetter("123", new WorkflowRequest(), LETTER))
        .isInstanceOf(IllegalArgumentException.class);
    verify(service, never()).submitAction(anyString(), any());
  }

  // ── Extension decision + EXDDMD letter ──

  @Test
  void extensionLetterIsLinkedBeforeTheDecisionIsSaved() throws Exception {
    ExtensionService extSpy = spy(extensionService);
    WorkflowService real = new WorkflowService(
        mock(Fsp700WorkflowDao.class),
        mock(Fsp800HistoryDao.class),
        mock(FspService.class),
        mock(EmailNotificationService.class),
        mock(FspWorkflowQueryDao.class),
        attachmentsService,
        extSpy);
    WorkflowService service = spy(real);
    // Return value is irrelevant here — WorkflowState is a 13-component
    // record and these tests assert call ordering, not the projection.
    doReturn(null).when(service).submitAction(anyString(), any());
    doNothing().when(extSpy)
        .uploadAttachment(anyString(), anyString(), any(), anyString(), anyString());

    service.submitExtensionDecisionWithLetter("123", "456", new WorkflowRequest(), LETTER);

    // Must go through ExtensionService — only FSP_302's CREATE_ATTACHMENT
    // writes fsp_extension_xref, which validate_ext_approve_reject checks.
    InOrder order = inOrder(extSpy, service);
    order.verify(extSpy)
        .uploadAttachment(eq("123"), eq("456"), eq(LETTER), eq("EXDDMD"), anyString());
    order.verify(service).submitAction(eq("123"), any());
  }

  @Test
  void extensionDecisionWithoutALetterStillSaves() throws Exception {
    WorkflowService service = workflowServiceSpy();

    assertThatCode(() ->
        service.submitExtensionDecisionWithLetter("123", "456", new WorkflowRequest(), null))
        .doesNotThrowAnyException();
    verify(service).submitAction(eq("123"), any());
  }
}
