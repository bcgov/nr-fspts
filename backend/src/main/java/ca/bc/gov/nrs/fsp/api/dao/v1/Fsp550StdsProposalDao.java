package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.util.List;

/**
 * Wraps THE.FSP_550_STDS_PROPOSAL.GET — the legacy FSP250 ("Standards
 * View") detail proc. Reads a single standards regime by id plus four
 * related cursors (org units, clients, attachments, BGC zones). The
 * proc carries write-mode actions too (ADD/SAVE/COPY/REMOVE) but only
 * the read path is wrapped here.
 */
public interface Fsp550StdsProposalDao {

  String PACKAGE_NAME = "FSP_550_STDS_PROPOSAL";
  String PROCEDURE_NAME = "GET";

  Result get(String regimeId, String fspId, String amendmentNumber);

  /** The four cursor lists + the scalar header row. */
  record Result(
      Header header,
      List<OrgUnitRow> districts,
      List<ClientRow> clients,
      List<AttachmentRow> attachments,
      List<BgcZoneRow> bgcZones,
      String errorMessage
  ) {}

  /**
   * Single row of p_standards_cursor. Subset of the proc's full column
   * list — the additional fields (regen/free-growing offsets, layer
   * indicator booleans, reject_note etc.) are read but not surfaced
   * until the layer-detail tabs land.
   */
  record Header(
      String standardsRegimeId,
      String fspIdList,
      String standardsRegimeName,
      String standardsObjective,
      String regulationCode,
      String regulationDescription,
      String geographicDescription,
      String standardsRegimeStatusCode,
      String statusDescription,
      String effectiveDate,
      String expiryDate,
      String regenObligationInd,
      String regenDelayOffsetYrs,
      String freeGrowingEarlyOffsetYrs,
      String freeGrowingLateOffsetYrs,
      String additionalStandards,
      String submittedByUserid,
      String mofDefaultStandardInd,
      String standardsAmendNumber,
      // Layer flags (Y/N) + matching standards_regime_layer ids from
      // positions 22-31 of the standards cursor. Drive the Layers
      // sub-tab strip in the front-end — only render a layer panel
      // when its flag is 'Y'. The layer id is what FSP_550_SUB_LAYERS
      // and FSP_550_SUB_SPECIES key off.
      String layerSingle,
      String layerSingleId,
      String layer1,
      String layer1Id,
      String layer2,
      String layer2Id,
      String layer3,
      String layer3Id,
      String layer4,
      String layer4Id
  ) {}

  record OrgUnitRow(String orgUnitNo, String orgUnitCode, String orgUnitName) {}

  record ClientRow(String clientNumber, String clientName, String clientAcronym) {}

  record AttachmentRow(
      String attachmentId,
      String attachmentName,
      String attachmentDescription,
      String mimeTypeCode,
      String fileSize
  ) {}

  record BgcZoneRow(
      String bgcZoneCode,
      String bgcSubzoneCode,
      String bgcVariant,
      String bgcPhase,
      String becSiteSeriesCd,
      String becSiteSeriesPhaseCd,
      String becSeral
  ) {}
}
