package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.FspAttachmentQueryDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FspValidationDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The "an FSP must have at least one FDU before it can be submitted" rule.
 *
 * <p>There is no proc equivalent: {@code fsp_common_validation}'s FDU checks
 * only fire when {@code fdu_update_ind = 'Y'}, so a plan that never declared
 * an FDU update could submit carrying no spatial record at all. The rule is
 * therefore enforced twice, and both need covering — as a preflight issue so
 * the SPA checklist shows it, and as a hard guard on submit so the API can't
 * be talked past it.
 */
class FspServiceFduRequiredTest {

  private static final String FSP = "1234";
  private static final String AMENDMENT = "0";
  /** Nothing declared, so only the FDU-presence rule can bite. */
  private static final FspValidationDao.UpdateIndicatorState CLEAN_INDICATORS =
      new FspValidationDao.UpdateIndicatorState(
          "ORG", "N", "N", false, false, "N", false, "N", false);

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
  void preflightReportsTheMissingFdu() {
    stubPreflight(/* hasFdu= */ false);

    var result = service.preflightSubmit(FSP, AMENDMENT);

    assertThat(result.valid()).isFalse();
    assertThat(result.issues()).anySatisfy(i -> {
      assertThat(i.code()).isEqualTo("FSP.NO.FDU");
      // Curated, and it names where to go — the code alone is no use to a
      // submitter looking at a checklist.
      assertThat(i.message()).contains("FDU/Map");
    });
  }

  @Test
  void preflightIsCleanOnceAnFduExists() {
    stubPreflight(/* hasFdu= */ true);

    var result = service.preflightSubmit(FSP, AMENDMENT);

    assertThat(result.issues()).noneMatch(i -> "FSP.NO.FDU".equals(i.code()));
    assertThat(result.valid()).isTrue();
  }

  @Test
  void preflightRaisesTheIssueOnlyOnce() {
    stubPreflight(/* hasFdu= */ false);

    var result = service.preflightSubmit(FSP, AMENDMENT);

    assertThat(result.issues().stream().filter(i -> "FSP.NO.FDU".equals(i.code())))
        .hasSize(1);
  }

  // ── hard guard ───────────────────────────────────────────────────────

  @Test
  void submitIsRejectedWhenThereIsNoFdu() {
    stubSubmit(/* hasFdu= */ false);

    assertThatThrownBy(() -> service.submit(FSP, AMENDMENT))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("Forest Development Unit");

    // The SUBMIT proc must never be reached — a rejected submit leaves the
    // status untouched rather than relying on a rollback. getById is stubbed
    // on the spy, so the real DAO seeing nothing means the proc was never
    // called.
    verifyNoInteractions(informationDao);
  }

  @Test
  void theGuardClearsOnceAnFduExists() {
    // With an FDU present the FDU rule stops biting; whatever happens next is
    // the proc's business, so assert only that this rule is no longer the
    // thing rejecting the submit.
    stubSubmit(/* hasFdu= */ true);

    try {
      service.submit(FSP, AMENDMENT);
    } catch (RuntimeException expectedFromTheMockedProc) {
      assertThat(expectedFromTheMockedProc.getMessage())
          .doesNotContain("Forest Development Unit");
    }
    verify(attachmentQueryDao).hasFdu(1234L, 0L);
  }

  @Test
  void theRuleIsScopedToTheAmendmentInQuestion() {
    // FDUs are per fsp+amendment (fsp_create_amendment copies them forward),
    // so the count has to be scoped to the amendment being checked rather than
    // the FSP as a whole — otherwise an amendment that lost its FDUs would
    // still pass on the strength of the original's.
    stubPreflight(/* hasFdu= */ true);

    service.preflightSubmit(FSP, "3");

    verify(attachmentQueryDao).hasFdu(1234L, 3L);
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private void stubPreflight(boolean hasFdu) {
    when(validationDao.validate(anyLong(), anyLong())).thenReturn(List.of());
    when(validationDao.getUpdateIndicatorState(anyLong(), anyLong()))
        .thenReturn(CLEAN_INDICATORS);
    when(attachmentQueryDao.hasLegalDocument(anyLong(), anyLong())).thenReturn(true);
    when(attachmentQueryDao.hasFdu(anyLong(), anyLong())).thenReturn(hasFdu);
  }

  /**
   * submit() reads the current row, runs the app-level guards, then calls the
   * proc. Only the guards are under test here, so the surrounding proc calls
   * are stubbed out on the spy.
   */
  private void stubSubmit(boolean hasFdu) {
    when(attachmentQueryDao.hasLegalDocument(anyLong(), anyLong())).thenReturn(true);
    when(attachmentQueryDao.hasFdu(anyLong(), anyLong())).thenReturn(hasFdu);
    when(validationDao.getUpdateIndicatorState(anyLong(), anyLong()))
        .thenReturn(CLEAN_INDICATORS);
    doReturn(FspRequest.builder().fspId(FSP).fspAmendmentNumber(AMENDMENT).build())
        .when(service).getById(anyString(), anyString());
  }
}
