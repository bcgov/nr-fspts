package ca.bc.gov.nrs.fsp.api.submission.persist;

import ca.bc.gov.nrs.fsp.api.dao.v1.OrgUnitLookupDao;
import ca.bc.gov.nrs.fsp.api.service.v1.FspService;
import ca.bc.gov.nrs.fsp.api.struct.v1.FspRequest;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Verifies SubmissionPersistenceService branches correctly on
 * actionCode: I → FspService.create(); U/A → FspService.update().
 * The downstream FDU / IA / Standards / Attachment services receive
 * the (possibly newly-assigned) fspId.
 */
class SubmissionPersistenceServiceTest {

  private FspService fspService;
  private FduPersistenceService fdu;
  private IdentifiedAreaPersistenceService identifiedAreas;
  private StandardsPersistenceService standards;
  private SubmissionAttachmentService attachments;
  private OrgUnitLookupDao orgUnitLookup;
  private SubmissionToFspRequestMapper mapper;
  private SubmissionPersistenceService service;

  @BeforeEach
  void freshMocks() {
    fspService = Mockito.mock(FspService.class);
    fdu = Mockito.mock(FduPersistenceService.class);
    identifiedAreas = Mockito.mock(IdentifiedAreaPersistenceService.class);
    standards = Mockito.mock(StandardsPersistenceService.class);
    attachments = Mockito.mock(SubmissionAttachmentService.class);
    orgUnitLookup = Mockito.mock(OrgUnitLookupDao.class);
    // Test submissions either don't carry districts or use codes that
    // resolve trivially; default the lookup to return a synthetic
    // number so any code resolves without bothering tests.
    Mockito.when(orgUnitLookup.findOrgUnitNoByCode(Mockito.anyString()))
        .thenReturn(java.util.Optional.of("12345"));
    mapper = new SubmissionToFspRequestMapper();
    service = new SubmissionPersistenceService(
        mapper, fspService, fdu, identifiedAreas, standards, attachments, orgUnitLookup);
  }

  @Test
  void initial_action_calls_create_and_threads_assigned_id() throws IOException {
    FSPSubmissionType submission = newInitialSubmission();
    // Proc returns a freshly-assigned fspId and amendment 1
    when(fspService.create(any())).thenAnswer(inv -> {
      FspRequest req = inv.getArgument(0);
      assertThat(req.getFspId()).isNull(); // create path must send null id
      return cloneWithId(req, "777", "1");
    });

    FspRequest saved = service.persist(submission, null);

    assertThat(saved.getFspId()).isEqualTo("777");
    verify(fspService).create(any());
    verify(fspService, never()).update(any(), any());

    // Downstream services should see the proc-assigned id, not null
    ArgumentCaptor<Long> fspIdCap = ArgumentCaptor.forClass(Long.class);
    verify(fdu).persist(any(), fspIdCap.capture(), eq(1L), any());
    assertThat(fspIdCap.getValue()).isEqualTo(777L);
    verify(identifiedAreas).persist(any(), eq(777L), eq(1L), any());
    verify(standards).persist(any(), eq(777L), eq(1L), any());
    verify(attachments, times(1)).persist(any(), eq(777L), eq(1L), anyInt(), any());
  }

  @Test
  void amendment_action_calls_amend_then_update_with_proc_assigned_number() throws IOException {
    FSPSubmissionType submission = amendmentSubmission("96", "6");
    // AMEND returns the proc-assigned amendment_number (the XML's
    // amendmentID is ignored; only amendment 0 exists in the dev DB,
    // so the proc would assign 1 next).
    when(fspService.amend(eq("96"), any()))
        .thenAnswer(inv -> cloneWithId(inv.getArgument(1), "96", "1"));
    when(fspService.update(eq("96"), any()))
        .thenAnswer(inv -> cloneWithId(inv.getArgument(1), "96", "1"));

    service.persist(submission, null);

    // AMEND first, then SAVE — both fire for actionCode=A
    verify(fspService).amend(eq("96"), any());
    verify(fspService).update(eq("96"), any());
    verify(fspService, never()).create(any());
    // Downstream services see the proc-assigned amendment (1), not the XML's 6
    verify(fdu).persist(any(), eq(96L), eq(1L), any());
    verify(attachments).persist(any(), eq(96L), eq(1L), anyInt(), any());
  }

  @Test
  void amendment_without_id_is_rejected() {
    FSPSubmissionType submission = amendmentSubmission(null, null);

    assertThatThrownBy(() -> service.persist(submission, null))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("requires an fspID");

    Mockito.verifyNoInteractions(fspService);
    Mockito.verifyNoInteractions(fdu, identifiedAreas, standards, attachments);
  }

  // -------- helpers --------

  private static FSPSubmissionType newInitialSubmission() {
    return buildSubmission(/*fspId=*/ null, /*amendment=*/ null, ActionCodeType.I);
  }

  private static FSPSubmissionType amendmentSubmission(String fspId, String amendment) {
    return buildSubmission(fspId, amendment, ActionCodeType.A);
  }

  private static FSPSubmissionType buildSubmission(
      String fspId, String amendment, ActionCodeType actionCode) {
    ForestStewardshipPlanType plan = new ForestStewardshipPlanType();
    plan.setActionCode(actionCode);
    plan.setPlanName("Test Plan");
    if (fspId != null) {
      plan.setFspID(Long.valueOf(fspId));
    }
    if (amendment != null) {
      plan.setAmendmentID(Long.valueOf(amendment));
    }
    // Proc validates ≥1 agreement holder — populate one
    PlanHolderAssociationType holders = new PlanHolderAssociationType();
    holders.getClientCode().add("00001271");
    plan.setPlanHolderList(holders);

    FSPSubmissionItemAssociationType item = new FSPSubmissionItemAssociationType();
    item.setForestStewardshipPlan(plan);

    FSPSubmissionType submission = new FSPSubmissionType();
    submission.setSubmissionItem(item);

    FSPSubmissionMetadataType meta = new FSPSubmissionMetadataType();
    meta.setLicenseeContact("Tester");
    submission.setFspSubmissionMetadata(meta);
    return submission;
  }

  private static FspRequest cloneWithId(FspRequest source, String fspId, String amendment) {
    return FspRequest.builder()
        .fspId(fspId)
        .fspAmendmentNumber(amendment)
        .fspPlanName(source.getFspPlanName())
        .fspAmendmentCode(source.getFspAmendmentCode())
        .agreementHolders(source.getAgreementHolders())
        .districts(source.getDistricts())
        .build();
  }

  // Suppress unused warning on ObjectFactory — kept for tests that
  // may need to wrap elements in JAXBElement<> later.
  @SuppressWarnings("unused")
  private static final ObjectFactory OF = new ObjectFactory();
}
