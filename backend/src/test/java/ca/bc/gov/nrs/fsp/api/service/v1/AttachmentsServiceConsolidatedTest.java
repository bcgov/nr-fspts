package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp400AttachmentsDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FspAttachmentQueryDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FspCodeListsDao;
import ca.bc.gov.nrs.fsp.api.exception.ConflictFoundException;
import ca.bc.gov.nrs.fsp.api.security.FspAccessGuard;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Legacy FSP400 legal-document rules: the original plan's legal document is
 * always consolidated, an amendment's legal document follows the user's
 * checkbox, no other category is ever consolidated, and a version may hold
 * only one legal document.
 */
class AttachmentsServiceConsolidatedTest {

  private static final String FSP = "759";
  private static final long FSP_ID = 759L;
  private static final long LATEST = 4L;

  private final Fsp400AttachmentsDao attachmentsDao = mock(Fsp400AttachmentsDao.class);
  private final FspAttachmentQueryDao queryDao = mock(FspAttachmentQueryDao.class);
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final AttachmentsService service = new AttachmentsService(
      attachmentsDao, queryDao, mock(FspCodeListsDao.class), jdbc,
      mock(FspAccessGuard.class), mock(VirusScanner.class));

  private final MockMultipartFile file =
      new MockMultipartFile("file", "legal.pdf", "application/pdf", "pdf".getBytes());

  @BeforeEach
  void stubLatestVersion() {
    when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class)))
        .thenReturn(LATEST);
    when(attachmentsDao.createAttachment(
        anyLong(), anyString(), anyString(), anyString(), anyLong(), anyString(),
        anyString(), any()))
        .thenReturn(new Fsp400AttachmentsDao.CreateAttachmentResult(1L, null));
  }

  @Test
  void originalPlanLegalDocIsAlwaysConsolidated() {
    assertThat(AttachmentsService.resolveConsolidatedInd("FSP", "0", null)).isEqualTo("Y");
    assertThat(AttachmentsService.resolveConsolidatedInd("FSP", "0", false)).isEqualTo("Y");
  }

  @Test
  void amendmentLegalDocFollowsCheckbox() {
    assertThat(AttachmentsService.resolveConsolidatedInd("FSP", "3", true)).isEqualTo("Y");
    assertThat(AttachmentsService.resolveConsolidatedInd("FSP", "3", false)).isEqualTo("N");
    assertThat(AttachmentsService.resolveConsolidatedInd("FSP", "3", null)).isEqualTo("N");
  }

  @Test
  void otherCategoriesAreNeverConsolidated() {
    assertThat(AttachmentsService.resolveConsolidatedInd("OTHR", "0", true)).isEqualTo("N");
    assertThat(AttachmentsService.resolveConsolidatedInd("MAP", "2", true)).isEqualTo("N");
    assertThat(AttachmentsService.resolveConsolidatedInd(null, "2", true)).isEqualTo("N");
  }

  @Test
  void secondLegalDocOnSameVersionIsRefused() {
    when(queryDao.hasLegalDocument(FSP_ID, LATEST)).thenReturn(true);

    assertThatThrownBy(() -> service.upload(FSP, file, "FSP", "", true))
        .isInstanceOf(ConflictFoundException.class)
        .hasMessage(AttachmentsService.LEGAL_DOC_EXISTS_MESSAGE);
    verify(attachmentsDao, never()).createAttachment(
        anyLong(), anyString(), anyString(), anyString(), anyLong(), anyString(),
        anyString(), any());
  }

  @Test
  void firstLegalDocIsStoredWithCheckboxValue() throws Exception {
    when(queryDao.hasLegalDocument(FSP_ID, LATEST)).thenReturn(false);
    try (MockedStatic<RequestUtil> req = mockStatic(RequestUtil.class)) {
      req.when(RequestUtil::getCurrentAuditUserId).thenReturn("IDIR\\TEST");

      assertThat(service.upload(FSP, file, "FSP", "", true).getConsolidatedInd())
          .isEqualTo("Y");
    }
    verify(attachmentsDao).createAttachment(
        eq(FSP_ID), eq("4"), eq("FSP"), eq("legal.pdf"), eq(3L), eq(""), eq("Y"),
        eq("IDIR\\TEST"));
  }

  @Test
  void otherCategoriesAreNotLimitedToOnePerVersion() throws Exception {
    when(queryDao.hasLegalDocument(FSP_ID, LATEST)).thenReturn(true);
    try (MockedStatic<RequestUtil> req = mockStatic(RequestUtil.class)) {
      req.when(RequestUtil::getCurrentAuditUserId).thenReturn("IDIR\\TEST");

      service.upload(FSP, file, "OTHR", "", true);
    }
    verify(attachmentsDao).createAttachment(
        eq(FSP_ID), eq("4"), eq("OTHR"), eq("legal.pdf"), eq(3L), eq(""), eq("N"),
        eq("IDIR\\TEST"));
  }
}
