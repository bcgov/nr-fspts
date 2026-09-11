package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.FspAttachmentQueryDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FspValidationDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The "MAP attachment but no FDU change" rule.
 *
 * <p>At DDM approval {@code FSP_700_WORKFLOW.validate_approval_rejection}
 * treats a MAP-category attachment as a claim that the FDUs changed, and
 * refuses approval ({@code FSP.CANNOT.APPROVE.NO_FDU_SPATIAL_ATTACHED}) when
 * no FDU on the version is new. The submit branch never checks it, so a
 * version with unchanged FDUs and a map filed under that category submitted
 * cleanly and then failed in front of the decision maker. The rule is
 * enforced as a preflight issue and as a hard guard on submit.
 */
class FspServiceMapAttachmentRuleTest {

  private static final String FSP = "1234";
  private static final String AMENDMENT = "2";
  private static final String CODE = "FSP.MAP_ATTACHMENT.NO_FDU_CHANGE";

  private FspAttachmentQueryDao attachmentQueryDao;
  private FspValidationDao validationDao;
  private ca.bc.gov.nrs.fsp.api.dao.v1.Fsp300InformationDao informationDao;
  private FspService service;

  @BeforeEach
  void setUp() {
    attachmentQueryDao = mock(FspAttachmentQueryDao.class);
    validationDao = mock(FspValidationDao.class);
    informationDao = mock(ca.bc.gov.nrs.fsp.api.dao.v1.Fsp300InformationDao.class);
    service = spy(new FspService(
        mock(ca.bc.gov.nrs.fsp.api.dao.v1.Fsp100SearchDao.class),
        mock(ca.bc.gov.nrs.fsp.api.dao.v1.FspSearchDirectDao.class),
        informationDao,
        validationDao,
        attachmentQueryDao,
        mock(ca.bc.gov.nrs.fsp.api.dao.v1.FspExtensionQueryDao.class),
        mock(ca.bc.gov.nrs.fsp.api.security.FspAccessGuard.class),
        mock(ca.bc.gov.nrs.fsp.api.client.FomByFspClient.class)));
  }

  // ── preflight ────────────────────────────────────────────────────────

  @Test
  void preflightFlagsAMapAttachmentWithNoFduChange() {
    // The reported case: stocking standards updated (so approval required),
    // FDUs declared unchanged, a MAP attachment on the amendment.
    stubPreflight(indicators("Y", "N", false), /* hasMap= */ true);

    var result = service.preflightSubmit(FSP, AMENDMENT);

    assertThat(result.valid()).isFalse();
    assertThat(result.issues()).anySatisfy(i -> {
      assertThat(i.code()).isEqualTo(CODE);
      assertThat(i.message()).contains("Map category").contains("Attachments tab");
    });
  }

  @Test
  void preflightIgnoresTheMapWhenApprovalIsNotRequired() {
    // No approval ⇒ no DDM decision ⇒ the proc check never runs.
    stubPreflight(indicators("N", "N", false), /* hasMap= */ true);

    var result = service.preflightSubmit(FSP, AMENDMENT);

    assertThat(result.issues()).noneMatch(i -> CODE.equals(i.code()));
  }

  @Test
  void preflightIgnoresTheMapWhenAnFduIsNew() {
    stubPreflight(indicators("Y", "N", true), /* hasMap= */ true);

    var result = service.preflightSubmit(FSP, AMENDMENT);

    assertThat(result.issues()).noneMatch(i -> CODE.equals(i.code()));
  }

  @Test
  void preflightIsCleanWithoutAMapAttachment() {
    stubPreflight(indicators("Y", "N", false), /* hasMap= */ false);

    var result = service.preflightSubmit(FSP, AMENDMENT);

    assertThat(result.issues()).noneMatch(i -> CODE.equals(i.code()));
    assertThat(result.valid()).isTrue();
  }

  @Test
  void theDeclaredCaseKeepsItsOwnRule() {
    // fdu_update_ind = 'Y' with no FDU change already has a dedicated code;
    // the checklist shouldn't list the same problem twice.
    stubPreflight(indicators("Y", "Y", false), /* hasMap= */ true);

    var result = service.preflightSubmit(FSP, AMENDMENT);

    assertThat(result.issues()).anyMatch(i -> "FSP.FDU_UPDATE_IND.NOCHANGE".equals(i.code()));
    assertThat(result.issues()).noneMatch(i -> CODE.equals(i.code()));
  }

  @Test
  void theRuleIsScopedToTheAmendmentInQuestion() {
    stubPreflight(indicators("Y", "N", false), /* hasMap= */ false);

    service.preflightSubmit(FSP, "3");

    verify(attachmentQueryDao).hasMapAttachment(1234L, 3L);
  }

  // ── hard guard ───────────────────────────────────────────────────────

  @Test
  void submitIsRejectedForAMapAttachmentWithNoFduChange() {
    stubSubmit(indicators("Y", "N", false), /* hasMap= */ true);

    assertThatThrownBy(() -> service.submit(FSP, AMENDMENT))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("Map category");

    // The SUBMIT proc must never be reached.
    verifyNoInteractions(informationDao);
  }

  @Test
  void theGuardClearsWithoutAMapAttachment() {
    stubSubmit(indicators("Y", "N", false), /* hasMap= */ false);

    try {
      service.submit(FSP, AMENDMENT);
    } catch (RuntimeException expectedFromTheMockedProc) {
      assertThat(expectedFromTheMockedProc.getMessage()).doesNotContain("Map category");
    }
    verify(attachmentQueryDao).hasMapAttachment(1234L, 2L);
  }

  // ── helpers ──────────────────────────────────────────────────────────

  /** An amendment carrying the indicators the rule reads; IA/SS clean. */
  private static FspValidationDao.UpdateIndicatorState indicators(
      String approvalRequiredInd, String fduUpdateInd, boolean fduSpatialChanges) {
    return new FspValidationDao.UpdateIndicatorState(
        "AMD", "N", fduUpdateInd,
        /* fduHasChanges= */ true, fduSpatialChanges,
        "N", false, "N", false,
        approvalRequiredInd);
  }

  private void stubPreflight(FspValidationDao.UpdateIndicatorState ind, boolean hasMap) {
    when(validationDao.validate(anyLong(), anyLong())).thenReturn(List.of());
    when(validationDao.getUpdateIndicatorState(anyLong(), anyLong())).thenReturn(ind);
    when(attachmentQueryDao.hasLegalDocument(anyLong(), anyLong())).thenReturn(true);
    when(attachmentQueryDao.hasFdu(anyLong(), anyLong())).thenReturn(true);
    when(attachmentQueryDao.hasMapAttachment(anyLong(), anyLong())).thenReturn(hasMap);
  }

  /**
   * submit() reads the current row, runs the app-level guards, then calls the
   * proc. Only the guards are under test here, so the surrounding proc calls
   * are stubbed out on the spy.
   */
  private void stubSubmit(FspValidationDao.UpdateIndicatorState ind, boolean hasMap) {
    when(attachmentQueryDao.hasLegalDocument(anyLong(), anyLong())).thenReturn(true);
    when(attachmentQueryDao.hasFdu(anyLong(), anyLong())).thenReturn(true);
    when(attachmentQueryDao.hasMapAttachment(anyLong(), anyLong())).thenReturn(hasMap);
    when(validationDao.getUpdateIndicatorState(anyLong(), anyLong())).thenReturn(ind);
    doReturn(FspRequest.builder().fspId(FSP).fspAmendmentNumber(AMENDMENT).build())
        .when(service).getById(anyString(), anyString());
  }
}
