package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550StdsProposalDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550SubLayersDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550SubSpeciesDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeBgcZoneUpsert;
import ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeCreate;
import ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeDetail;
import ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeLayerDetail;
import ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeLayerUpdate;
import ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeOverviewUpdate;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

/**
 * Read wrapper for the FSP250 "Standards View" page. Pulls a single
 * standards regime plus its related lists; the audit-user context is
 * not needed here — the proc gates on the regime id + (optional) fsp
 * id / amendment number to scope the district + client cursors.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class StandardRegimeService {

  private final Fsp550StdsProposalDao dao;
  private final Fsp550SubLayersDao layersDao;
  private final Fsp550SubSpeciesDao speciesDao;

  public StandardRegimeDetail getDetail(String fspId, String amendmentNumber, String regimeId) {
    return getDetailInternal(fspId, amendmentNumber, regimeId, "Y");
  }

  /**
   * Regime-only GET — used by the standards-search modal where the
   * regime is opened without an FSP context. Calls the proc with
   * blank fspId/amendmentNumber and {@code display_fsp_org_clients='N'}
   * so org-unit + client cursors return the regime's own data rather
   * than trying to scope to an FSP that may not match or be accessible.
   */
  public StandardRegimeDetail getDetailByRegime(String regimeId) {
    log.info("getDetailByRegime regimeId={} (display=N, no FSP scope)", regimeId);
    return getDetailInternal("", "", regimeId, "N");
  }

  private StandardRegimeDetail getDetailInternal(
      String fspId, String amendmentNumber, String regimeId, String displayFspOrgClients) {
    Fsp550StdsProposalDao.Result r =
        dao.get(regimeId, fspId, amendmentNumber, displayFspOrgClients);
    log.info("FSP_550_STDS_PROPOSAL.GET regimeId={} fspId={} amendment={} display={} → header={}",
        regimeId, fspId, amendmentNumber, displayFspOrgClients,
        r == null || r.header() == null ? "NULL" : "present");
    Fsp550StdsProposalDao.Header h = r.header();
    if (h == null) return null;
    // TEMP DIAGNOSTIC — the Layers tab is showing empty. Log the raw
    // layer flags as the DAO read them so we can confirm whether the
    // cursor positions are right and the proc is returning 'Y'.
    log.info("StandardRegime {} layer flags: single={}/{}, 1={}/{}, 2={}/{}, 3={}/{}, 4={}/{}",
        regimeId,
        h.layerSingle(), h.layerSingleId(),
        h.layer1(), h.layer1Id(),
        h.layer2(), h.layer2Id(),
        h.layer3(), h.layer3Id(),
        h.layer4(), h.layer4Id());
    // Translate the regime's layer Y/N flags into a list the front-end
    // can iterate. Stocking layer codes are I (single), 1, 2, 3, 4 —
    // see the FSP_550_SUB_LAYERS proc docs.
    List<StandardRegimeDetail.LayerSummary> layers = new ArrayList<>();
    if ("Y".equals(h.layerSingle())) {
      layers.add(new StandardRegimeDetail.LayerSummary("I", h.layerSingleId()));
    }
    if ("Y".equals(h.layer1())) {
      layers.add(new StandardRegimeDetail.LayerSummary("1", h.layer1Id()));
    }
    if ("Y".equals(h.layer2())) {
      layers.add(new StandardRegimeDetail.LayerSummary("2", h.layer2Id()));
    }
    if ("Y".equals(h.layer3())) {
      layers.add(new StandardRegimeDetail.LayerSummary("3", h.layer3Id()));
    }
    if ("Y".equals(h.layer4())) {
      layers.add(new StandardRegimeDetail.LayerSummary("4", h.layer4Id()));
    }
    return new StandardRegimeDetail(
        h.standardsRegimeId(),
        h.fspIdList(),
        h.standardsRegimeName(),
        h.standardsObjective(),
        h.regulationCode(),
        h.regulationDescription(),
        h.geographicDescription(),
        h.standardsRegimeStatusCode(),
        h.statusDescription(),
        h.effectiveDate(),
        h.expiryDate(),
        h.regenObligationInd(),
        h.regenDelayOffsetYrs(),
        h.freeGrowingEarlyOffsetYrs(),
        h.freeGrowingLateOffsetYrs(),
        h.noRegenEarlyOffsetYrs(),
        h.noRegenLateOffsetYrs(),
        h.additionalStandards(),
        h.submittedByUserid(),
        h.mofDefaultStandardInd(),
        h.standardsAmendNumber(),
        h.revisionCount(),
        layers,
        r.districts().stream()
            .map(d -> new StandardRegimeDetail.District(
                d.orgUnitNo(), d.orgUnitCode(), d.orgUnitName()))
            .toList(),
        r.clients().stream()
            .map(c -> new StandardRegimeDetail.AgreementHolder(
                c.clientNumber(), c.clientName(), c.clientAcronym()))
            .toList(),
        r.bgcZones().stream()
            .map(b -> new StandardRegimeDetail.BgcZone(
                b.stdsRegimeSiteSeriesId(),
                b.bgcZoneCode(), b.bgcSubzoneCode(), b.bgcVariant(), b.bgcPhase(),
                b.becSiteSeriesCd(), b.becSiteSeriesPhaseCd(), b.becSeral(),
                b.revisionCount()))
            .toList());
  }

  /**
   * Save edits to a regime's Overview tab. Reads the current record to
   * pick up the fields not present in the request body (status code,
   * regulation, no-regen offsets, revision count, etc.), overlays only
   * the non-null caller-supplied values, then routes the merged record
   * through {@code FSP_550_STDS_PROPOSAL.SAVE}. After save, re-reads
   * the detail so the response carries any proc-derived changes (status
   * description recompute, bumped revision_count, etc.).
   */
  @Transactional
  public StandardRegimeDetail saveOverview(
      String fspId, String regimeId, String amendmentNumber,
      StandardRegimeOverviewUpdate edits) {
    StandardRegimeDetail current = getDetail(fspId, amendmentNumber, regimeId);
    if (current == null) {
      throw new IllegalStateException(
          "Standards regime " + regimeId + " not found for FSP " + fspId);
    }
    String name = pick(edits.getStandardsRegimeName(), current.standardsRegimeName());
    String objective = pick(edits.getStandardsObjective(), current.standardsObjective());
    String geo = pick(edits.getGeographicDescription(), current.geographicDescription());
    String additional = pick(edits.getAdditionalStandards(), current.additionalStandards());
    String effective = pick(edits.getEffectiveDate(), current.effectiveDate());
    String expiry = pick(edits.getExpiryDate(), current.expiryDate());
    String regen = pick(edits.getRegenObligationInd(), current.regenObligationInd());
    String regenDelay = pick(edits.getRegenDelayOffsetYrs(), current.regenDelayOffsetYrs());
    String fgEarly = pick(edits.getFreeGrowingEarlyOffsetYrs(), current.freeGrowingEarlyOffsetYrs());
    String fgLate = pick(edits.getFreeGrowingLateOffsetYrs(), current.freeGrowingLateOffsetYrs());

    Fsp550StdsProposalDao.SaveRequest req = new Fsp550StdsProposalDao.SaveRequest(
        regimeId,
        fspId,
        amendmentNumber == null ? "" : amendmentNumber,
        name,
        objective,
        current.regulationCode(),       // not editable on this tab
        geo,
        current.standardsRegimeStatusCode(), // workflow-managed
        effective,
        expiry,
        regen,
        regenDelay,
        fgEarly,
        fgLate,
        current.noRegenEarlyOffsetYrs(),
        current.noRegenLateOffsetYrs(),
        additional,
        RequestUtil.getCurrentAuditUserId(),
        current.revisionCount());
    Fsp550StdsProposalDao.SaveResult result = dao.save(req);
    log.info("Standards regime {} saved by {} — new revision_count={}",
        result.standardsRegimeId(), RequestUtil.getCurrentAuditUserId(), result.revisionCount());
    return getDetail(fspId, amendmentNumber, regimeId);
  }

  /** Null in the edit → keep the current value; non-null (incl. "") wins. */
  private static String pick(String edit, String current) {
    return edit != null ? edit : current;
  }

  /**
   * Insert a brand-new standards regime against the given FSP +
   * amendment via {@code FSP_550_STDS_PROPOSAL.SAVE} with the
   * INOUT {@code standardsRegimeId} bound NULL — the proc detects
   * the null and routes to the insert branch, allocating the next
   * id from {@code STANDARDS_REGIME_ID_SEQ}. The new id is returned
   * via the SAVE result so the SPA can navigate the user straight
   * to the new regime's detail panel.
   *
   * <p>Layers, species, and BGC zones are added separately via the
   * existing per-layer endpoints — this method only seeds the
   * tombstone / regen-obligation header row.
   */
  @Transactional
  public StandardRegimeDetail createRegime(String fspId, StandardRegimeCreate body) {
    String userId = RequestUtil.getCurrentAuditUserId();
    // STANDARDS_REGIME.SILV_STATUTE_CODE is VARCHAR2(3) and is a FK
    // to THE.SILV_STATUTE_CODE — the actual codes vary by deployment
    // and are surfaced to the SPA via /code-lists/statutes. Whatever
    // the SPA picked must already be in the table or the proc trips
    // SR_SSTCD_FK. No fallback here — let the proc surface the FK
    // violation if the caller sends a missing/invalid value.
    String regulation = body.getRegulationCode();
    Fsp550StdsProposalDao.SaveRequest req = new Fsp550StdsProposalDao.SaveRequest(
        null,                                  // INOUT — null triggers insert
        fspId,
        body.getFspAmendmentNumber(),
        body.getStandardsRegimeName(),
        body.getStandardsObjective(),
        regulation,
        body.getGeographicDescription(),
        "",                                    // status — proc defaults on insert
        body.getEffectiveDate(),
        body.getExpiryDate(),
        body.getRegenObligationInd(),
        body.getRegenDelayOffsetYrs(),
        body.getFreeGrowingEarlyOffsetYrs(),
        body.getFreeGrowingLateOffsetYrs(),
        body.getNoRegenEarlyOffsetYrs(),
        body.getNoRegenLateOffsetYrs(),
        body.getAdditionalStandards(),
        userId,
        null);                                 // revision_count INOUT — null on insert
    Fsp550StdsProposalDao.SaveResult result = dao.save(req);
    log.info("Created standards regime {} on fsp {} amendment {} by {}",
        result.standardsRegimeId(), fspId, body.getFspAmendmentNumber(), userId);
    return getDetail(fspId, body.getFspAmendmentNumber(), result.standardsRegimeId());
  }

  /**
   * Duplicate an existing standards regime on the same FSP / amendment.
   * The proc copies the header row plus every child (layers, species,
   * BGC site series) under a freshly-assigned regime id and returns
   * the new regime's full detail so the SPA can navigate to it.
   *
   * <p>Used by the Copy Standard button on the Stocking Standards tab
   * (DFT-only). The source regime's revision_count is needed by the
   * proc's optimistic-lock check; fetched up-front via the lightweight
   * {@link Fsp550StdsProposalDao#getRevisionCount(String)} helper so
   * we don't have to run the heavier GET for it.</p>
   */
  @Transactional
  public StandardRegimeDetail copyRegime(
      String fspId, String amendmentNumber, String sourceRegimeId) {
    String userId = RequestUtil.getCurrentAuditUserId();
    String revisionCount = dao.getRevisionCount(sourceRegimeId);
    if (revisionCount == null) {
      throw new IllegalArgumentException(
          "Source standards regime " + sourceRegimeId + " not found.");
    }
    Fsp550StdsProposalDao.CopyResult result = dao.copyRegime(
        new Fsp550StdsProposalDao.CopyRequest(
            sourceRegimeId,
            fspId,
            amendmentNumber,
            "",                                  // org_unit_no — inherit from source
            RequestUtil.getCurrentClientNumber(),
            userId,
            revisionCount));
    log.info("Copied standards regime {} → {} on fsp {} amendment {} by {}",
        sourceRegimeId, result.newRegimeId(), fspId, amendmentNumber, userId);
    return getDetail(fspId, amendmentNumber, result.newRegimeId());
  }

  /**
   * Loads the per-layer detail (densities + species lists) for one
   * layer of a regime. Composes FSP_550_SUB_LAYERS.GET with two
   * FSP_550_SUB_SPECIES.GET calls (preferred + acceptable). The
   * regime id is needed because the SubLayers proc validates the
   * layer belongs to the regime; for SubSpecies only the layer id
   * is needed.
   */
  public StandardRegimeLayerDetail getLayerDetail(
      String regimeId, String layerCode, String layerId) {
    Fsp550SubLayersDao.Result layer = layersDao.mainline(
        "GET",
        regimeId,
        layerId,
        layerCode,
        "", "", "", "", "", "", "", "", "", "",
        "", "", "");
    List<StandardRegimeLayerDetail.Species> preferred =
        readSpecies(regimeId, layerId, "Y");
    List<StandardRegimeLayerDetail.Species> acceptable =
        readSpecies(regimeId, layerId, "N");
    return new StandardRegimeLayerDetail(
        layerCode,
        layerId,
        layer.pTreeSizeUnitCode(),
        layer.pTargetStocking(),
        layer.pMinHorizontalDistance(),
        layer.pMinPrefStockingStandard(),
        layer.pMinStockingStandard(),
        layer.pResidualBasalArea(),
        layer.pMinPostSpacing(),
        layer.pMaxPostSpacing(),
        layer.pMaxConifer(),
        layer.pHghtRelativeToComp(),
        layer.pRevisionCount(),
        preferred,
        acceptable);
  }

  /**
   * Save edits to a single layer's scalar density/spacing fields via
   * FSP_550_SUB_LAYERS.MAINLINE("SAVE"). Reads the current layer to
   * fill in non-edited fields + the layer revision_count, then re-reads
   * the parent regime to pick up its current standards_revision_count
   * (the proc bumps the parent's row on every layer save). Species
   * rows are not affected — they're saved through their own proc.
   *
   * <p>Returns the refreshed layer detail (with the bumped revision
   * count) so the UI can stay in sync.
   */
  @Transactional
  public StandardRegimeLayerDetail saveLayer(
      String fspId, String regimeId, String layerCode, String layerId,
      StandardRegimeLayerUpdate edits) {
    // Blank layerId = ADD path. The legacy SAVE proc routes to ADD when
    // P_REVISION_COUNT is null, so we skip the current-detail fetch (no
    // current exists) and pass nulls for both the layer id and revision.
    // The proc returns the assigned id via the INOUT pStandardsRegimeLayerId
    // slot so we can re-fetch using the new id.
    final boolean isAdd = layerId == null || layerId.isBlank();
    StandardRegimeDetail regime = getDetail(fspId, null, regimeId);
    if (regime == null) {
      throw new IllegalStateException(
          "Standards regime " + regimeId + " not found for FSP " + fspId);
    }
    StandardRegimeLayerDetail current = isAdd
        ? null
        : getLayerDetail(regimeId, layerCode, layerId);
    Fsp550SubLayersDao.Result r = layersDao.mainline(
        "SAVE",
        regimeId,
        isAdd ? null : layerId,
        layerCode,
        pick(edits.getTargetStocking(), valueOf(current, StandardRegimeLayerDetail::targetStocking)),
        pick(edits.getMinHorizontalDistance(), valueOf(current, StandardRegimeLayerDetail::minHorizontalDistance)),
        pick(edits.getMinPrefStockingStandard(), valueOf(current, StandardRegimeLayerDetail::minPrefStockingStandard)),
        pick(edits.getMinStockingStandard(), valueOf(current, StandardRegimeLayerDetail::minStockingStandard)),
        pick(edits.getResidualBasalArea(), valueOf(current, StandardRegimeLayerDetail::residualBasalArea)),
        pick(edits.getMinPostSpacing(), valueOf(current, StandardRegimeLayerDetail::minPostSpacing)),
        pick(edits.getMaxPostSpacing(), valueOf(current, StandardRegimeLayerDetail::maxPostSpacing)),
        pick(edits.getMaxConifer(), valueOf(current, StandardRegimeLayerDetail::maxConifer)),
        pick(edits.getHeightRelativeToComp(), valueOf(current, StandardRegimeLayerDetail::heightRelativeToComp)),
        pick(edits.getTreeSizeUnitCode(), valueOf(current, StandardRegimeLayerDetail::treeSizeUnitCode)),
        RequestUtil.getCurrentAuditUserId(),
        isAdd ? null : current.revisionCount(),
        regime.revisionCount());
    String effectiveLayerId = isAdd ? r.pStandardsRegimeLayerId() : layerId;
    log.info("Standards regime {} layer {} ({}) {} by {} — new layer revision_count={}",
        regimeId, effectiveLayerId, layerCode,
        isAdd ? "created" : "saved",
        RequestUtil.getCurrentAuditUserId(), r.pRevisionCount());
    return getLayerDetail(regimeId, layerCode, effectiveLayerId);
  }

  private static <T> String valueOf(T source, java.util.function.Function<T, String> getter) {
    return source == null ? null : getter.apply(source);
  }

  /**
   * Toggle between even-aged (single layer 'I') and uneven-aged
   * (layers 1-4) via FSP_550_SUB_LAYERS.MAINLINE(CONVERT_LAYERS).
   *
   * <p>The proc auto-detects the current shape and converts in the
   * opposite direction. Internally it:
   * <ul>
   *   <li>Single → Multi: renames the 'I' layer to '4' and inserts
   *       empty layers 1, 2, 3.</li>
   *   <li>Multi → Single: deletes layers 1, 2, 3 (and their species)
   *       and renames layer '4' to 'I'.</li>
   * </ul>
   *
   * <p>p_revision_count is unused by the underlying convert_layers
   * routine but the MAINLINE signature requires a value; we pass blank.
   * The parent regime's revision_count IS used by update_audit_info
   * after the convert succeeds.
   */
  @Transactional
  public StandardRegimeDetail convertLayers(
      String fspId, String amendmentNumber, String regimeId) {
    String regimeRev = dao.getRevisionCount(regimeId);
    if (regimeRev == null) {
      throw new IllegalStateException(
          "Standards regime " + regimeId + " not found");
    }
    layersDao.mainline(
        "CONVERT_LAYERS",
        regimeId,
        "", "",                                   // layer id + stocking layer code
        "", "", "", "", "", "", "", "", "", "",   // scalar layer fields — unused
        RequestUtil.getCurrentAuditUserId(),
        "",                                       // p_revision_count — unread by convert_layers
        regimeRev);
    log.info("Standards regime {} — layers converted by {} (parent rev was {})",
        regimeId, RequestUtil.getCurrentAuditUserId(), regimeRev);
    return getDetail(fspId, amendmentNumber, regimeId);
  }

  private List<StandardRegimeLayerDetail.Species> readSpecies(
      String regimeId, String layerId, String preferredInd) {
    Fsp550SubSpeciesDao.Result r = speciesDao.mainline(
        "GET",
        layerId,
        "", "", "",
        preferredInd,
        "", "",
        regimeId,
        "");
    return r.rows().stream()
        .map(row -> new StandardRegimeLayerDetail.Species(
            row.silvTreeSpeciesCodeNew(),
            row.speciesDescription(),
            row.minHeight(),
            row.revisionCount()))
        .toList();
  }

  /**
   * Add one species row to a layer (preferred or acceptable). The
   * legacy SAVE proc treats a null revision_count as an INSERT; with a
   * value it would UPDATE. Returns the refreshed layer detail so the
   * UI redraws both species lists in one round-trip.
   */
  @Transactional
  public StandardRegimeLayerDetail addLayerSpecies(
      String fspId, String regimeId, String layerCode, String layerId,
      String speciesCode, String minHeight, boolean preferred) {
    // Cheaper than the full GET proc (5 cursors) and avoids the
    // proc's FSP+amendment-scope check, which trips noRecord when
    // we don't have those in hand.
    String regimeRev = dao.getRevisionCount(regimeId);
    if (regimeRev == null) {
      throw new IllegalStateException(
          "Standards regime " + regimeId + " not found");
    }
    Fsp550SubSpeciesDao.Result result = speciesDao.mainline(
        "SAVE",
        layerId,
        speciesCode,
        null,                           // silvTreeSpeciesCodeOld — only set on UPDATE-rename
        minHeight,
        preferred ? "Y" : "N",
        RequestUtil.getCurrentAuditUserId(),
        null,                           // revisionCount null → INSERT
        regimeId,
        regimeRev);
    log.info("Standards regime {} layer {} ({}) — added species {} (preferred={}). new standards_rev={}",
        regimeId, layerId, layerCode, speciesCode, preferred,
        result == null || result.header() == null ? null : result.header().pStandardsRevisionCount());
    return getLayerDetail(regimeId, layerCode, layerId);
  }

  /**
   * Delete one species row from a layer. Needs the row's
   * {@code revisionCount} for the proc's optimistic-lock check.
   */
  @Transactional
  public StandardRegimeLayerDetail deleteLayerSpecies(
      String fspId, String regimeId, String layerCode, String layerId,
      String speciesCode, boolean preferred, String revisionCount) {
    String regimeRev = dao.getRevisionCount(regimeId);
    if (regimeRev == null) {
      throw new IllegalStateException(
          "Standards regime " + regimeId + " not found");
    }
    speciesDao.mainline(
        "DELETE",
        layerId,
        speciesCode,
        null,
        null,
        preferred ? "Y" : "N",
        RequestUtil.getCurrentAuditUserId(),
        revisionCount,
        regimeId,
        regimeRev);
    log.info("Standards regime {} layer {} ({}) — deleted species {} (preferred={})",
        regimeId, layerId, layerCode, speciesCode, preferred);
    return getLayerDetail(regimeId, layerCode, layerId);
  }

  /**
   * Insert or update one row of STANDARDS_REGIME_SITE_SERIES through
   * FSP_550_STDS_PROPOSAL.SAVE_BGC_ITEM. Null {@code siteSeriesId} +
   * {@code rowRevisionCount} → INSERT branch; non-null → UPDATE branch
   * with optimistic-lock check on the row revision.
   *
   * <p>The parent regime's revision_count is bumped by the proc's
   * {@code update_audit_info} call, so we re-read the full detail to
   * surface the new value to the UI.
   */
  @Transactional
  public StandardRegimeDetail saveBgcItem(
      String fspId, String amendmentNumber, String regimeId,
      String siteSeriesId, String rowRevisionCount,
      StandardRegimeBgcZoneUpsert edits) {
    String regimeRev = dao.getRevisionCount(regimeId);
    if (regimeRev == null) {
      throw new IllegalStateException(
          "Standards regime " + regimeId + " not found");
    }
    Fsp550StdsProposalDao.SaveBgcRequest req = new Fsp550StdsProposalDao.SaveBgcRequest(
        siteSeriesId,
        regimeId,
        edits.getBgcZoneCode(),
        edits.getBgcSubzoneCode(),
        edits.getBgcVariant(),
        edits.getBgcPhase(),
        edits.getBecSiteSeriesCd(),
        edits.getBecSiteSeriesPhaseCd(),
        edits.getBecSeral(),
        RequestUtil.getCurrentAuditUserId(),
        rowRevisionCount,
        regimeRev);
    Fsp550StdsProposalDao.SaveBgcResult result = dao.saveBgcItem(req);
    log.info("Standards regime {} — {} BGC site-series id={} by {}",
        regimeId,
        rowRevisionCount == null ? "added" : "updated",
        result.stdsRegimeSiteSeriesId(),
        RequestUtil.getCurrentAuditUserId());
    return getDetail(fspId, amendmentNumber, regimeId);
  }

  /**
   * Delete one row of STANDARDS_REGIME_SITE_SERIES via
   * FSP_550_STDS_PROPOSAL.REMOVE_BGC_ITEM. The row's own
   * {@code revisionCount} is required for the optimistic-lock check;
   * the parent regime's revision_count is bumped by the proc on success.
   */
  @Transactional
  public StandardRegimeDetail deleteBgcItem(
      String fspId, String amendmentNumber, String regimeId,
      String siteSeriesId, String rowRevisionCount) {
    String regimeRev = dao.getRevisionCount(regimeId);
    if (regimeRev == null) {
      throw new IllegalStateException(
          "Standards regime " + regimeId + " not found");
    }
    dao.removeBgcItem(new Fsp550StdsProposalDao.RemoveBgcRequest(
        siteSeriesId,
        regimeId,
        RequestUtil.getCurrentAuditUserId(),
        rowRevisionCount,
        regimeRev));
    log.info("Standards regime {} — removed BGC site-series id={} by {}",
        regimeId, siteSeriesId, RequestUtil.getCurrentAuditUserId());
    return getDetail(fspId, amendmentNumber, regimeId);
  }

}
