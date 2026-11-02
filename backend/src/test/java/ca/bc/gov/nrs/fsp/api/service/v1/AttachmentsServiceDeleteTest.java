package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp400AttachmentsDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FspAttachmentQueryDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FspCodeListsDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.StoredProcedureException;
import ca.bc.gov.nrs.fsp.api.security.FspAccessGuard;
import ca.bc.gov.nrs.fsp.api.struct.v1.AttachmentResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * An attachment can only be removed from a version it's linked to, and only an
 * Administrator can remove one from a version other than the latest. The proc
 * reports success when it removes nothing, so these rules live in the service.
 */
class AttachmentsServiceDeleteTest {

  private static final String FSP = "759";
  private static final long FSP_ID = 759L;
  private static final long LATEST = 4L;
  private static final long PRIOR = 2L;
  private static final Long ON_LATEST = 100L;
  private static final Long ON_PRIOR = 200L;

  private final Fsp400AttachmentsDao attachmentsDao = mock(Fsp400AttachmentsDao.class);
  private final FspAttachmentQueryDao queryDao = mock(FspAttachmentQueryDao.class);
  private final FspCodeListsDao codeListsDao = mock(FspCodeListsDao.class);
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final FspAccessGuard guard = mock(FspAccessGuard.class);

  private final AttachmentsService service = new AttachmentsService(
      attachmentsDao, queryDao, codeListsDao, jdbc, guard, mock(VirusScanner.class));

  @BeforeEach
  void stubVersions() {
    when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class)))
        .thenReturn(LATEST);
    when(queryDao.findLinkedAttachmentIds(FSP_ID, LATEST)).thenReturn(Set.of(ON_LATEST));
    when(queryDao.findLinkedAttachmentIds(FSP_ID, PRIOR)).thenReturn(Set.of(ON_PRIOR));
    when(codeListsDao.getFspAttachmentTypeCodeMap()).thenReturn(Map.of());
  }

  private void stubList(List<Fsp400AttachmentsDao.AttachmentRow> rows) {
    when(attachmentsDao.get(any(), any(), any(), any(), any(), any(), any()))
        .thenReturn(new Fsp400AttachmentsDao.GetResult(
            rows, List.of(), List.of(), List.of(), List.of(),
            List.of(), List.of(), List.of(), List.of(), null));
  }

  private static Fsp400AttachmentsDao.AttachmentRow row(Long id, long amendment) {
    return new Fsp400AttachmentsDao.AttachmentRow(
        String.valueOf(id), String.valueOf(amendment), "file.pdf", "", "1", "N");
  }

  private void stubPermissions(boolean canEdit, boolean priorVersions) {
    when(guard.canEditAttachments(FSP)).thenReturn(canEdit);
    when(guard.canDeleteFromPriorVersions()).thenReturn(priorVersions);
  }

  private String deleteTarget(Long id) {
    return service.getByFspId(FSP).stream()
        .filter(r -> String.valueOf(id).equals(r.getFspAttachmentId()))
        .findFirst()
        .orElseThrow()
        .getDeleteAmendmentNumber();
  }

  // ── delete ───────────────────────────────────────────────────────────

  @Test
  void blankVersionRemovesTheAttachmentFromTheLatestVersion() {
    service.delete(FSP, ON_LATEST, null);

    verify(guard).assertAttachmentEditable(FSP, null);
    verify(attachmentsDao).removeAttachment(FSP_ID, "4", ON_LATEST);
  }

  @Test
  void attachmentNotLinkedToTheLatestVersionIsAnErrorNotAFalseSuccess() {
    assertThatThrownBy(() -> service.delete(FSP, ON_PRIOR, null))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("wasn't deleted");

    verify(attachmentsDao, never()).removeAttachment(any(), any(), any());
  }

  @Test
  void administratorCanDeleteFromAPriorVersion() {
    service.delete(FSP, ON_PRIOR, "2");

    verify(guard).assertPriorVersionAttachmentDeletable(FSP, "2");
    verify(attachmentsDao).removeAttachment(FSP_ID, "2", ON_PRIOR);
  }

  @Test
  void nonAdministratorIsRefusedOnAPriorVersion() {
    doThrow(new StoredProcedureException("FSP_TOMBSTONE", "user_may_access", "denied"))
        .when(guard).assertPriorVersionAttachmentDeletable(FSP, "2");

    assertThatThrownBy(() -> service.delete(FSP, ON_PRIOR, "2"))
        .isInstanceOf(StoredProcedureException.class);

    verify(attachmentsDao, never()).removeAttachment(any(), any(), any());
  }

  @Test
  void priorVersionDeleteStillRequiresTheAttachmentToBeLinkedThere() {
    assertThatThrownBy(() -> service.delete(FSP, ON_LATEST, "2"))
        .isInstanceOf(IllegalArgumentException.class);

    verify(attachmentsDao, never()).removeAttachment(any(), any(), any());
  }

  @Test
  void nonNumericVersionIsRejectedBeforeAnyWrite() {
    assertThatThrownBy(() -> service.delete(FSP, ON_LATEST, "abc"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("The FSP version must be a number.");

    verify(attachmentsDao, never()).removeAttachment(any(), any(), any());
  }

  // ── list ─────────────────────────────────────────────────────────────

  @Test
  void submitterCanDeleteOnlyFilesLinkedToTheLatestVersion() {
    stubList(List.of(row(ON_LATEST, LATEST), row(ON_PRIOR, PRIOR)));
    stubPermissions(true, false);

    assertThat(deleteTarget(ON_LATEST)).isEqualTo("4");
    assertThat(deleteTarget(ON_PRIOR)).isNull();
  }

  @Test
  void administratorCanDeleteFilesFromAPriorVersion() {
    stubList(List.of(row(ON_LATEST, LATEST), row(ON_PRIOR, PRIOR)));
    stubPermissions(true, true);

    assertThat(deleteTarget(ON_LATEST)).isEqualTo("4");
    assertThat(deleteTarget(ON_PRIOR)).isEqualTo("2");
  }

  @Test
  void fileLinkedToBothVersionsTargetsTheLatestEvenThoughItListsUnderTheEarliest() {
    stubList(List.of(row(ON_LATEST, PRIOR)));
    stubPermissions(true, false);

    assertThat(deleteTarget(ON_LATEST)).isEqualTo("4");
  }

  @Test
  void nothingIsDeletableWhenTheUserCantEditAttachmentsOnTheLatestVersion() {
    stubList(List.of(row(ON_LATEST, LATEST)));
    stubPermissions(false, true);

    assertThat(deleteTarget(ON_LATEST)).isNull();
  }
}
