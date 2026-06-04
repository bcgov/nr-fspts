package ca.bc.gov.nrs.fsp.api.submission.persist;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550StdsProposalDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550SubLayersDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550SubSpeciesDao;
import ca.bc.gov.nrs.fsp.api.submission.parser.generated.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.List;

/**
 * Increment 4 of XML-submission persistence: writes stocking-standards
 * regimes declared in {@code newFSPStandardsList} via the legacy
 * FSP_550_STDS_PROPOSAL.SAVE / SAVE_BGC_ITEM procs plus the
 * FSP_550_SUB_LAYERS.MAINLINE / FSP_550_SUB_SPECIES.MAINLINE
 * write actions (these already exist on the DAOs — we just call them
 * with {@code pAction="SAVE"}).
 *
 * <p>For each new regime in the submission we:
 * <ol>
 *   <li>SAVE the header (FSP_550_STDS_PROPOSAL.SAVE) — proc assigns
 *       STANDARDS_REGIME_ID</li>
 *   <li>SAVE_BGC_ITEM once per BGCType</li>
 *   <li>For each standard layer: SUB_LAYERS.MAINLINE(SAVE) — proc
 *       assigns STANDARDS_REGIME_LAYER_ID</li>
 *   <li>For each species under that layer: SUB_SPECIES.MAINLINE(SAVE)</li>
 * </ol>
 *
 * <p>Open assumptions:
 * <ul>
 *   <li><b>existingStandardsList</b> — the submission can also reference
 *       pre-existing regime IDs ({@code List&lt;Long&gt;}). This service
 *       does NOT yet associate those with the FSP; the FSP-regime
 *       xref table write is deferred (need to identify the proc).</li>
 *   <li><b>RegenObjectives mapping</b> — the XML only carries 3 offset
 *       fields (regen / early / late) but the SAVE proc accepts 5
 *       (regen_delay, free_grow_early, free_grow_late, no_regen_early,
 *       no_regen_late). We map regen→delay, early→free_grow_early,
 *       late→free_grow_late and leave the no_regen offsets blank.
 *       Confirm against the legacy ESF mapping when it's available.</li>
 *   <li><b>BGC site type / phase</b> — XML's bgcSiteType doesn't have
 *       an obvious proc-side counterpart in SAVE_BGC_ITEM; we pass it
 *       through bec_site_series_phase_cd as a best guess, since the
 *       READ cursor returns that column from the same place.</li>
 *   <li><b>Stocking-layer numeric fields</b> — the XML's
 *       targetStocking and minPrefStockingStandard map straight to
 *       wellSpaced / minPrefWellSpaced in the schema (legacy renamed
 *       these around 2010). Pass through verbatim.</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class StandardsPersistenceService {

  private static final String ACTION_SAVE = "SAVE";

  private final Fsp550StdsProposalDao stdsProposalDao;
  private final Fsp550SubLayersDao subLayersDao;
  private final Fsp550SubSpeciesDao subSpeciesDao;

  public void persist(
      ForestStewardshipPlanType plan, long fspId, long amendmentNumber, String userId) {
    StandardsAssociationType standards = plan.getStockingStandards();
    if (standards == null
        || standards.getNewFSPStandardsList() == null
        || standards.getNewFSPStandardsList().getFSPStandard() == null
        || standards.getNewFSPStandardsList().getFSPStandard().isEmpty()) {
      log.info("No new stocking-standards regimes in submission for fspId={} amendment={} — skipping",
          fspId, amendmentNumber);
      return;
    }

    List<FSPStandardsType> regimes = standards.getNewFSPStandardsList().getFSPStandard();
    log.info("Persisting {} stocking-standards regime(s) for fspId={} amendment={}",
        regimes.size(), fspId, amendmentNumber);

    String fspIdStr = Long.toString(fspId);
    String amendmentStr = Long.toString(amendmentNumber);

    for (FSPStandardsType regime : regimes) {
      persistRegime(regime, fspIdStr, amendmentStr, userId);
    }
  }

  private void persistRegime(
      FSPStandardsType regime, String fspId, String amendmentNumber, String userId) {
    RegenObjectivesType regen = regime.getRegenObjectives();
    String regenObligationInd = regen != null && regen.isRegenObligationInd() ? "Y" : "N";

    Fsp550StdsProposalDao.SaveRequest header = new Fsp550StdsProposalDao.SaveRequest(
        null, // standardsRegimeId — proc will assign and return via INOUT
        fspId,
        amendmentNumber,
        regime.getStandardsRegimeName(),
        regime.getStandardsObjective(),
        null, // regulationCode — not carried in XML; defaulted server-side
        regime.getGeographicDescription(),
        null, // standardsRegimeStatusCode — proc sets initial state
        null, // effectiveDate — submission-level
        null, // expiryDate — submission-level
        regenObligationInd,
        regen == null ? null : intToString(regen.getRegenOffset()),
        regen == null ? null : intToString(regen.getEarlyOffset()),
        regen == null ? null : Integer.toString(regen.getLateOffset()),
        null, // noRegenEarlyOffsetYrs — XML lacks this; see service javadoc
        null, // noRegenLateOffsetYrs — XML lacks this; see service javadoc
        regime.getAdditionalStandards(),
        userId,
        null /* revisionCount null → INSERT */);

    Fsp550StdsProposalDao.SaveResult saved = stdsProposalDao.save(header);
    String regimeId = saved.standardsRegimeId();
    // FSP_550_STDS_PROPOSAL.add (insert path) inserts with revision_count = 1
    // but doesn't echo that back through p_revision_count — it stays the
    // null we passed in. Downstream SAVE_BGC_ITEM / SUB_LAYERS / SUB_SPECIES
    // each call UPDATE_AUDIT_INFO which checks
    //   WHERE revision_count = p_standards_revision_count
    // then bumps it by 1. Track the bumped value across the cascade
    // (BGC → layers → species) so each call sees the current value.
    RegimeRevisionTracker rev = new RegimeRevisionTracker(
        saved.revisionCount() != null ? saved.revisionCount() : "1");
    log.debug("Regime '{}' saved → id={} startingRevision={}",
        regime.getStandardsRegimeName(), regimeId, rev.current());

    persistBgcs(regime, regimeId, userId, rev);
    persistLayers(regime, regimeId, userId, rev);
  }

  /**
   * Mutable counter threaded through the BGC / layer / species writes
   * so each call passes the current {@code standards_regime.revision_count}
   * value and bumps it locally to reflect the proc's UPDATE_AUDIT_INFO
   * side effect.
   */
  private static final class RegimeRevisionTracker {
    private int value;

    RegimeRevisionTracker(String initial) {
      this.value = Integer.parseInt(initial);
    }

    String current() {
      return Integer.toString(value);
    }

    /** Call after a proc that bumps the regime's revision_count by 1. */
    void bump() {
      value++;
    }

    /** Overwrite from an INOUT return when the proc tells us the new value. */
    void set(String fromProc) {
      if (fromProc != null && !fromProc.isBlank()) {
        try {
          value = Integer.parseInt(fromProc);
        } catch (NumberFormatException ignored) {
          // proc returned something non-numeric — keep our tracked value
        }
      }
    }
  }

  private void persistBgcs(
      FSPStandardsType regime, String regimeId, String userId, RegimeRevisionTracker rev) {
    if (regime.getBgcList() == null) {
      return;
    }
    for (var bgcWrapper : regime.getBgcList()) {
      if (bgcWrapper == null || bgcWrapper.getBgc() == null) {
        continue;
      }
      for (BGCType bgc : bgcWrapper.getBgc()) {
        stdsProposalDao.saveBgcItem(new Fsp550StdsProposalDao.SaveBgcRequest(
            null,
            regimeId,
            bgc.getBgcZone(),
            bgc.getBgcSubzone(),
            bgc.getBgcVariant(),
            bgc.getBgcPhase(),
            bgc.getBgcSiteSeries(),
            bgc.getBgcSiteType(),
            bgc.getBgcSeral(),
            userId,
            null, // revisionCount null → INSERT
            rev.current()));
        // SAVE_BGC_ITEM's UPDATE_AUDIT_INFO bumps the regime's
        // revision_count by 1 — track locally so the next call sees
        // the right value (the proc IN-only for this slot, can't
        // echo back).
        rev.bump();
      }
    }
  }

  private void persistLayers(
      FSPStandardsType regime, String regimeId, String userId, RegimeRevisionTracker rev) {
    if (regime.getStandardLayerList() == null) {
      return;
    }
    for (StandardLayerListAssociationType layerWrapper : regime.getStandardLayerList()) {
      if (layerWrapper == null || layerWrapper.getStandardLayer() == null) {
        continue;
      }
      for (StandardLayerType layer : layerWrapper.getStandardLayer()) {
        // One-shot diagnostic log of every param so 06502 conversion
        // failures inside the proc can be pinpointed without re-reading
        // the deployed package body. Drop or move to debug once stable.
        log.info(
            "SUB_LAYERS.MAINLINE(SAVE) params: regimeId={}, layerCode={}, "
                + "targetStocking(wellSpaced)={}, minHorizontalDistance={}, "
                + "minPrefStockingStandard(minPrefWellSpaced)={}, minStockingStandard={}, "
                + "residualBasalArea={}, minPostSpacing={}, maxPostSpacing={}, "
                + "maxConifer={}, hghtRelativeToComp={}, treeSizeUnitCode(hghtCompCode)={}, "
                + "userId={}, revisionCount=null, standardsRevisionCount={}",
            regimeId,
            layer.getStockingLayerCode(),
            intToString(layer.getWellSpaced()),
            decimalToString(layer.getMinHorizontalDistance()),
            intToString(layer.getMinPrefWellSpaced()),
            intToString(layer.getMinStockingStandard()),
            intToString(layer.getResidualBasalArea()),
            longToString(layer.getMinPostSpacing()),
            longToString(layer.getMaxPostSpacing()),
            longToString(layer.getMaxConifer()),
            intToString(layer.getHeightRelativeToComp()),
            layer.getHeightRelativeToCompCode(),
            userId,
            rev.current());

        Fsp550SubLayersDao.Result layerResult = subLayersDao.mainline(
            ACTION_SAVE,
            regimeId,
            null, // standardsRegimeLayerId — proc assigns
            layer.getStockingLayerCode(),
            intToString(layer.getWellSpaced()),
            decimalToString(layer.getMinHorizontalDistance()),
            intToString(layer.getMinPrefWellSpaced()),
            intToString(layer.getMinStockingStandard()),
            intToString(layer.getResidualBasalArea()),
            longToString(layer.getMinPostSpacing()),
            longToString(layer.getMaxPostSpacing()),
            longToString(layer.getMaxConifer()),
            intToString(layer.getHeightRelativeToComp()),
            layer.getHeightRelativeToCompCode(),
            userId,
            null, // revisionCount null → INSERT
            rev.current());

        String layerId = layerResult.pStandardsRegimeLayerId();
        // SUB_LAYERS.MAINLINE bumps the regime — prefer the value
        // the proc returns via INOUT, fall back to local +1.
        if (layerResult.pStandardsRevisionCount() != null
            && !layerResult.pStandardsRevisionCount().isBlank()) {
          rev.set(layerResult.pStandardsRevisionCount());
        } else {
          rev.bump();
        }
        log.debug("Layer '{}' on regime {} saved → layerId={} newRegimeRevision={}",
            layer.getStockingLayerCode(), regimeId, layerId, rev.current());
        persistSpecies(layer, regimeId, layerId, userId, rev);
      }
    }
  }

  private void persistSpecies(
      StandardLayerType layer,
      String regimeId,
      String layerId,
      String userId,
      RegimeRevisionTracker rev) {
    if (layer.getStandardLayerSpeciesList() == null) {
      return;
    }
    for (StandardLayerSpeciesListAssociationType speciesWrapper
        : layer.getStandardLayerSpeciesList()) {
      if (speciesWrapper == null || speciesWrapper.getStandardLayerSpecies() == null) {
        continue;
      }
      for (StandardLayerSpeciesType species : speciesWrapper.getStandardLayerSpecies()) {
        Fsp550SubSpeciesDao.Result result = subSpeciesDao.mainline(
            ACTION_SAVE,
            layerId,
            species.getSpeciesCode(),
            null, // silvTreeSpeciesCodeOld — only set on UPDATE-rename
            decimalToString(species.getMinHeight()),
            Boolean.TRUE.equals(species.isPreferredSpeciesInd()) ? "Y" : "N",
            userId,
            null, // revisionCount null → INSERT
            regimeId,
            rev.current());
        // Same pattern as SUB_LAYERS — prefer the proc's returned value.
        String returned = result != null && result.header() != null
            ? result.header().pStandardsRevisionCount()
            : null;
        if (returned != null && !returned.isBlank()) {
          rev.set(returned);
        } else {
          rev.bump();
        }
      }
    }
  }

  private static String intToString(Integer i) {
    return i == null ? null : Integer.toString(i);
  }

  private static String longToString(Long l) {
    return l == null ? null : Long.toString(l);
  }

  private static String decimalToString(BigDecimal d) {
    return d == null ? null : d.toPlainString();
  }
}
