package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550StdsProposalDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550SubLayersDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp550SubSpeciesDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeDetail;
import ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeLayerDetail;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

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
    Fsp550StdsProposalDao.Result r = dao.get(regimeId, fspId, amendmentNumber);
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
        h.additionalStandards(),
        h.submittedByUserid(),
        h.mofDefaultStandardInd(),
        h.standardsAmendNumber(),
        layers,
        r.districts().stream()
            .map(d -> new StandardRegimeDetail.District(
                d.orgUnitNo(), d.orgUnitCode(), d.orgUnitName()))
            .toList(),
        r.clients().stream()
            .map(c -> new StandardRegimeDetail.AgreementHolder(
                c.clientNumber(), c.clientName(), c.clientAcronym()))
            .toList(),
        r.attachments().stream()
            .map(a -> new StandardRegimeDetail.Attachment(
                a.attachmentId(), a.attachmentName(), a.attachmentDescription(),
                a.mimeTypeCode(), a.fileSize()))
            .toList(),
        r.bgcZones().stream()
            .map(b -> new StandardRegimeDetail.BgcZone(
                b.bgcZoneCode(), b.bgcSubzoneCode(), b.bgcVariant(), b.bgcPhase(),
                b.becSiteSeriesCd(), b.becSiteSeriesPhaseCd(), b.becSeral()))
            .toList());
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
        preferred,
        acceptable);
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
            row.minHeight()))
        .toList();
  }
}
