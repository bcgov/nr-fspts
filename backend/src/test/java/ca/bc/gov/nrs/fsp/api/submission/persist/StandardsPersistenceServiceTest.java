package ca.bc.gov.nrs.fsp.api.submission.persist;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550StdsProposalDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550SubLayersDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550SubSpeciesDao;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Verifies the orchestration order across the three DAOs for a single
 * regime carrying one BGC + one layer + one species. Real proc calls
 * are not exercised (no test Oracle DB).
 */
class StandardsPersistenceServiceTest {

  private Fsp550StdsProposalDao proposalDao;
  private Fsp550SubLayersDao subLayersDao;
  private Fsp550SubSpeciesDao subSpeciesDao;
  private StandardsPersistenceService service;

  @BeforeEach
  void freshMocks() {
    proposalDao = Mockito.mock(Fsp550StdsProposalDao.class);
    subLayersDao = Mockito.mock(Fsp550SubLayersDao.class);
    subSpeciesDao = Mockito.mock(Fsp550SubSpeciesDao.class);

    // Header SAVE returns the assigned regime id and an initial revision count
    when(proposalDao.save(any())).thenReturn(
        new Fsp550StdsProposalDao.SaveResult("12345", "1", null));
    // SubLayers SAVE returns the assigned layer id
    when(subLayersDao.mainline(any(), any(), any(), any(), any(), any(), any(), any(),
        any(), any(), any(), any(), any(), any(), any(), any(), any()))
        .thenReturn(new Fsp550SubLayersDao.Result(
            "SAVE", "12345", "67890", "S",
            null, null, null, null, null, null, null, null, null, null,
            "TESTUSR", "1", "2", null));

    service = new StandardsPersistenceService(proposalDao, subLayersDao, subSpeciesDao);
  }

  @Test
  void persists_regime_then_bgc_then_layer_then_species() {
    ForestStewardshipPlanType plan = planWithOneRegime();

    service.persist(plan, 96L, 6L, "TESTUSR");

    // Header SAVE — verify the IDs and key fields landed
    ArgumentCaptor<Fsp550StdsProposalDao.SaveRequest> headerCap =
        ArgumentCaptor.forClass(Fsp550StdsProposalDao.SaveRequest.class);
    verify(proposalDao).save(headerCap.capture());
    Fsp550StdsProposalDao.SaveRequest h = headerCap.getValue();
    assertThat(h.standardsRegimeId()).isNull();   // null → insert
    assertThat(h.fspId()).isEqualTo("96");
    assertThat(h.fspAmendmentNumber()).isEqualTo("6");
    assertThat(h.standardsRegimeName()).isEqualTo("Test Regime");
    assertThat(h.standardsObjective()).isEqualTo("Conserve wildlife habitat");
    assertThat(h.regenObligationInd()).isEqualTo("Y");
    assertThat(h.regenDelayOffsetYrs()).isEqualTo("3");
    assertThat(h.freeGrowingEarlyOffsetYrs()).isEqualTo("8");
    assertThat(h.freeGrowingLateOffsetYrs()).isEqualTo("15");
    assertThat(h.additionalStandards()).isEqualTo("See attachment.");
    assertThat(h.updateUserid()).isEqualTo("TESTUSR");
    assertThat(h.revisionCount()).isNull();       // null → insert

    // BGC item SAVE — keyed off the returned regime id
    ArgumentCaptor<Fsp550StdsProposalDao.SaveBgcRequest> bgcCap =
        ArgumentCaptor.forClass(Fsp550StdsProposalDao.SaveBgcRequest.class);
    verify(proposalDao).saveBgcItem(bgcCap.capture());
    Fsp550StdsProposalDao.SaveBgcRequest b = bgcCap.getValue();
    assertThat(b.standardsRegimeId()).isEqualTo("12345");
    assertThat(b.bgcZoneCode()).isEqualTo("SBS");
    assertThat(b.bgcSubzoneCode()).isEqualTo("mc");
    assertThat(b.bgcVariant()).isEqualTo("3");
    assertThat(b.standardsRevisionCount()).isEqualTo("1");

    // SubLayers SAVE — verify regime id threaded through + null layer id.
    // standardsRevisionCount = "2" because BGC's UPDATE_AUDIT_INFO has
    // already bumped the regime from 1 → 2 before this call.
    verify(subLayersDao).mainline(
        Mockito.eq("SAVE"),
        Mockito.eq("12345"),                       // regimeId
        Mockito.eq(null),                          // layerId — null → insert
        Mockito.eq("S"),                           // stockingLayerCode
        Mockito.eq("1200"),                        // wellSpaced
        Mockito.eq("2.5"),                         // minHorizontalDistance
        Mockito.eq("900"),                         // minPrefWellSpaced
        Mockito.eq("500"),                         // minStockingStandard
        Mockito.eq(null),                          // residualBasalArea
        Mockito.eq(null),                          // minPostSpacing
        Mockito.eq(null),                          // maxPostSpacing
        Mockito.eq(null),                          // maxConifer
        Mockito.eq(null),                          // hghtRelativeToComp
        Mockito.eq(null),                          // treeSizeUnitCode
        Mockito.eq("TESTUSR"),                     // userId
        Mockito.eq(null),                          // revisionCount — null → insert
        Mockito.eq("2"));                          // bumped past BGC's UPDATE_AUDIT_INFO

    // SubSpecies SAVE — the SubLayers mock returns "2" via
    // pStandardsRevisionCount (the mock's freshMocks() answer), so the
    // tracker is set to "2" before SubSpecies fires.
    verify(subSpeciesDao).mainline(
        Mockito.eq("SAVE"),
        Mockito.eq("67890"),                       // layerId
        Mockito.eq("PL"),                          // speciesCode
        Mockito.eq(null),                          // oldSpeciesCode (only on UPDATE-rename)
        Mockito.eq("2.0"),                         // minHeight
        Mockito.eq("Y"),                           // preferredInd
        Mockito.eq("TESTUSR"),
        Mockito.eq(null),                          // revisionCount — null → insert
        Mockito.eq("12345"),                       // regimeId
        Mockito.eq("2"));                          // standardsRevisionCount from layer mock
  }

  @Test
  void noop_when_no_new_regimes() {
    ForestStewardshipPlanType empty = new ForestStewardshipPlanType();
    service.persist(empty, 96L, 6L, "TESTUSR");
    Mockito.verifyNoInteractions(proposalDao, subLayersDao, subSpeciesDao);
  }

  @Test
  void persists_multiple_regimes() {
    ForestStewardshipPlanType plan = planWithTwoRegimes();
    when(proposalDao.save(any()))
        .thenReturn(new Fsp550StdsProposalDao.SaveResult("1001", "1", null))
        .thenReturn(new Fsp550StdsProposalDao.SaveResult("1002", "1", null));

    service.persist(plan, 96L, 6L, "TESTUSR");

    verify(proposalDao, times(2)).save(any());
  }

  // -------- JAXB tree builders --------

  private static ForestStewardshipPlanType planWithOneRegime() {
    FSPStandardsType regime = new FSPStandardsType();
    regime.setStandardsRegimeName("Test Regime");
    regime.setStandardsObjective("Conserve wildlife habitat");
    regime.setAdditionalStandards("See attachment.");

    RegenObjectivesType regen = new RegenObjectivesType();
    regen.setRegenObligationInd(true);
    regen.setRegenOffset(3);
    regen.setEarlyOffset(8);
    regen.setLateOffset(15);
    regime.setRegenObjectives(regen);

    BGCType bgc = new BGCType();
    bgc.setBgcZone("SBS");
    bgc.setBgcSubzone("mc");
    bgc.setBgcVariant("3");
    BGCAssociationListType bgcWrap = new BGCAssociationListType();
    bgcWrap.getBgc().add(bgc);
    regime.getBgcList().add(bgcWrap);

    StandardLayerType layer = new StandardLayerType();
    layer.setStockingLayerCode("S");
    layer.setWellSpaced(1200);
    layer.setMinHorizontalDistance(new BigDecimal("2.5"));
    layer.setMinPrefWellSpaced(900);
    layer.setMinStockingStandard(500);

    StandardLayerSpeciesType species = new StandardLayerSpeciesType();
    species.setSpeciesCode("PL");
    species.setMinHeight(new BigDecimal("2.0"));
    species.setPreferredSpeciesInd(true);
    StandardLayerSpeciesListAssociationType speciesWrap = new StandardLayerSpeciesListAssociationType();
    speciesWrap.getStandardLayerSpecies().add(species);
    layer.getStandardLayerSpeciesList().add(speciesWrap);

    StandardLayerListAssociationType layerWrap = new StandardLayerListAssociationType();
    layerWrap.getStandardLayer().add(layer);
    regime.getStandardLayerList().add(layerWrap);

    StandardsAssociationType standards = new StandardsAssociationType();
    StandardsAssociationType.NewFSPStandardsList newList =
        new StandardsAssociationType.NewFSPStandardsList();
    newList.getFSPStandard().add(regime);
    standards.setNewFSPStandardsList(newList);

    ForestStewardshipPlanType plan = new ForestStewardshipPlanType();
    plan.setStockingStandards(standards);
    return plan;
  }

  private static ForestStewardshipPlanType planWithTwoRegimes() {
    ForestStewardshipPlanType plan = planWithOneRegime();
    FSPStandardsType second = new FSPStandardsType();
    second.setStandardsRegimeName("Second Regime");
    RegenObjectivesType regen = new RegenObjectivesType();
    regen.setRegenObligationInd(false);
    second.setRegenObjectives(regen);
    plan.getStockingStandards().getNewFSPStandardsList().getFSPStandard().add(second);
    return plan;
  }
}
