package ca.bc.gov.nrs.fsp.api.service.v1;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550StdsProposalDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550SubLayersDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550SubSpeciesDao;
import ca.bc.gov.nrs.fsp.api.security.FspAccessGuard;
import ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeDetail;
import ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeLayerUpdate;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Unit tests for the legacy-parity "Add default standard" (ASSOC) and
 * "Unlink default standard" (UNLINK) paths on {@link StandardRegimeService}.
 *
 * <p>Focus is the behaviour those methods add on top of the DAO: the
 * access-guard call, the request the DAO is handed, and — critically — the
 * server-side "is this actually a MoF default?" gate on unlink, which stops a
 * copied draft's FSP xref from being silently orphaned (the proc's DELETE is
 * generic on fsp_id + regime_id).
 *
 * <p>No security context is set up: {@code RequestUtil.getCurrentAuditUserId()}
 * safely returns "" without a JWT, so the audit user id on the ASSOC request is
 * "" here — which is what we assert.
 */
@ExtendWith(MockitoExtension.class)
class StandardRegimeServiceTest {

  private static final String FSP = "F1";
  private static final String AMEND = "0";
  private static final String REGIME = "R1";

  @Mock private Fsp550StdsProposalDao dao;
  @Mock private Fsp550SubLayersDao layersDao;
  @Mock private Fsp550SubSpeciesDao speciesDao;
  @Mock private FspAccessGuard accessGuard;
  @Mock private VirusScanner virusScanner;

  private StandardRegimeService service;

  @BeforeEach
  void setUp() {
    service = new StandardRegimeService(dao, layersDao, speciesDao, accessGuard, virusScanner);
  }

  @Test
  void unlinkDefault_unlinks_whenRegimeIsAMofDefault() {
    when(dao.get(REGIME, FSP, AMEND, "Y")).thenReturn(result(REGIME, "Y"));

    service.unlinkDefault(FSP, AMEND, REGIME);

    verify(accessGuard).assertContentEditable(FSP, AMEND);
    verify(dao).unlinkDefault(
        new Fsp550StdsProposalDao.UnlinkRequest(FSP, AMEND, REGIME));
  }

  @Test
  void unlinkDefault_rejects_whenRegimeIsNotADefault() {
    // A copied draft (mof_default = 'N') must NOT be unlinkable — that would
    // orphan the regime (xref gone, regime left behind). Delete is its path.
    when(dao.get(REGIME, FSP, AMEND, "Y")).thenReturn(result(REGIME, "N"));

    assertThatThrownBy(() -> service.unlinkDefault(FSP, AMEND, REGIME))
        .isInstanceOf(IllegalArgumentException.class);

    verify(dao, never()).unlinkDefault(any());
  }

  @Test
  void assocRegime_links_andReturnsTheLinkedDetail() {
    when(dao.get(REGIME, FSP, AMEND, "Y")).thenReturn(result(REGIME, "Y"));

    StandardRegimeDetail detail = service.assocRegime(FSP, AMEND, REGIME);

    verify(accessGuard).assertContentEditable(FSP, AMEND);
    // No JWT in the test → audit user id resolves to "".
    verify(dao).assocRegime(
        new Fsp550StdsProposalDao.AssocRequest(FSP, AMEND, REGIME, ""));
    assertThat(detail.standardsRegimeId()).isEqualTo(REGIME);
    assertThat(detail.mofDefaultStandardInd()).isEqualTo("Y");
  }

  // ── helpers ──────────────────────────────────────────────────────────

  /** A GET result carrying just the fields these paths read (id + default flag). */
  private static Fsp550StdsProposalDao.Result result(String regimeId, String mofDefaultInd) {
    return new Fsp550StdsProposalDao.Result(
        header(regimeId, mofDefaultInd), List.of(), List.of(), List.of(), List.of(), null);
  }

  /** Header record (32 fields) — everything null except id (pos 1) + the MoF
   *  default flag (pos 20). */
  private static Fsp550StdsProposalDao.Header header(String regimeId, String mofDefaultInd) {
    return new Fsp550StdsProposalDao.Header(
        regimeId, null, null, null, null, null, null, null, null, null, // 1-10
        null, null, null, null, null, null, null, null, null, mofDefaultInd, // 11-20
        null, null, null, null, null, null, null, null, null, null, // 21-30
        null, null); // 31-32
  }

  // ── Layer numeric bounds ──
  //
  // STANDARDS_REGIME_LAYER's columns have tight precisions. Exceeding one
  // raises ORA-01438 inside FSP_550_SUB_LAYERS, which escapes as an opaque
  // 500 naming no field. These pin the boundaries so the failure is a clean
  // 400 instead.

  private static StandardRegimeLayerUpdate layerWithMinHoriz(String value) {
    StandardRegimeLayerUpdate u = new StandardRegimeLayerUpdate();
    u.setMinHorizontalDistance(value);
    return u;
  }

  @Test
  void saveLayer_rejects_minHorizontalDistanceOver99point9() {
    // The reported production failure: MIN_HORIZONTAL_DISTANCE is
    // NUMBER(3,1) — max 99.9 — but it sits beside stocking counts in the
    // hundreds, so 350 looks plausible and blew up at the insert.
    assertThatThrownBy(() ->
        service.saveLayer(FSP, REGIME, "1", "145584", AMEND, layerWithMinHoriz("350")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("Min horizontal distance")
        .hasMessageContaining("99.9");

    verifyNoInteractions(layersDao);
  }

  @Test
  void saveLayer_rejects_minHorizontalDistanceWithTwoDecimals() {
    assertThatThrownBy(() ->
        service.saveLayer(FSP, REGIME, "1", "145584", AMEND, layerWithMinHoriz("12.34")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("decimal place");
  }

  @Test
  void saveLayer_rejects_aWholeNumberFieldGivenADecimal() {
    StandardRegimeLayerUpdate u = new StandardRegimeLayerUpdate();
    u.setTargetStocking("700.5"); // NUMBER(5) — scale 0
    assertThatThrownBy(() ->
        service.saveLayer(FSP, REGIME, "1", "145584", AMEND, u))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("whole number");
  }

  @Test
  void saveLayer_rejects_targetStockingOverFiveDigits() {
    StandardRegimeLayerUpdate u = new StandardRegimeLayerUpdate();
    u.setTargetStocking("100000"); // NUMBER(5) — max 99999
    assertThatThrownBy(() ->
        service.saveLayer(FSP, REGIME, "1", "145584", AMEND, u))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("99999");
  }

  @Test
  void saveLayer_boundsAreCheckedBeforeAnythingElseHappens() {
    // Cheap input check runs ahead of the access guard and the regime
    // fetch, so a bad number costs no DB round-trips.
    assertThatThrownBy(() ->
        service.saveLayer(FSP, REGIME, "1", "145584", AMEND, layerWithMinHoriz("350")))
        .isInstanceOf(IllegalArgumentException.class);

    verify(dao, never()).get(any(), any(), any(), any());
  }
}
