package ca.bc.gov.nrs.fsp.api.service.v1;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550StdsProposalDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550SubLayersDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550SubSpeciesDao;
import ca.bc.gov.nrs.fsp.api.security.FspAccessGuard;
import ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeDetail;
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

  private StandardRegimeService service;

  @BeforeEach
  void setUp() {
    service = new StandardRegimeService(dao, layersDao, speciesDao, accessGuard);
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
        header(regimeId, mofDefaultInd), List.of(), List.of(), List.of(), null);
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
}
