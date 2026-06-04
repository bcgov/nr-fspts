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
  String PROCEDURE_SAVE = "SAVE";
  String PROCEDURE_SAVE_BGC_ITEM = "SAVE_BGC_ITEM";

  Result get(String regimeId, String fspId, String amendmentNumber);

  /**
   * Lightweight lookup of just the standards_regime row's
   * revision_count. Used by the species CRUD flow which needs the
   * parent's optimistic-lock token but doesn't need the full GET
   * proc's five cursors (and can't always supply the FSP/amendment
   * scope GET requires). Returns {@code null} when the regime id
   * doesn't exist.
   */
  String getRevisionCount(String regimeId);

  /**
   * Wraps {@code FSP_550_STDS_PROPOSAL.SAVE}. On insert the proc
   * assigns a new STANDARDS_REGIME_ID — pass {@code regimeId=null}
   * and {@code revisionCount=null} to trigger that branch; the
   * returned {@link SaveResult} carries the assigned id back.
   */
  SaveResult save(SaveRequest req);

  /**
   * Wraps {@code FSP_550_STDS_PROPOSAL.SAVE_BGC_ITEM}. Inserts one
   * row of STANDARDS_REGIME_SITE_SERIES. Same NULL-revision-count
   * insert pattern; returns the assigned site-series id.
   */
  SaveBgcResult saveBgcItem(SaveBgcRequest req);

  record SaveRequest(
      String standardsRegimeId, // INOUT — null on insert, returns assigned id
      String fspId,
      String fspAmendmentNumber,
      String standardsRegimeName,
      String standardsObjective,
      String regulationCode,
      String geographicDescription,
      String standardsRegimeStatusCode,
      String effectiveDate,
      String expiryDate,
      String regenObligationInd,
      String regenDelayOffsetYrs,
      String freeGrowingEarlyOffsetYrs,
      String freeGrowingLateOffsetYrs,
      String noRegenEarlyOffsetYrs,
      String noRegenLateOffsetYrs,
      String additionalStandards,
      String updateUserid,
      String revisionCount // INOUT — null on insert, returns 1
  ) {}

  record SaveResult(String standardsRegimeId, String revisionCount, String errorMessage) {}

  record SaveBgcRequest(
      String stdsRegimeSiteSeriesId, // INOUT — null on insert
      String standardsRegimeId,
      String bgcZoneCode,
      String bgcSubzoneCode,
      String bgcVariant,
      String bgcPhase,
      String becSiteSeriesCd,
      String becSiteSeriesPhaseCd,
      String becSeral,
      String updateUserid,
      String revisionCount,
      String standardsRevisionCount // bumped by SAVE on the parent regime
  ) {}

  record SaveBgcResult(String stdsRegimeSiteSeriesId, String errorMessage) {}

  /**
   * Fetches the BLOB content + display name for a single standards-regime
   * attachment. Backs the Standards View attachments-tab download
   * action. Mirrors legacy FSP_550_STDS_PROPOSAL.GET_ATTACHMENT_BLOB —
   * 4 positional params: regime_attach_id INOUT, attachment_name OUT,
   * attachment_data BLOB INOUT, error_message OUT.
   */
  AttachmentBlob getAttachmentBlob(String regimeAttachId);

  record AttachmentBlob(String attachmentName, byte[] content) {}

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
      // Surfaced so the Overview SAVE can round-trip these without
      // overwriting the column with NULL. Not editable in the UI yet.
      String noRegenEarlyOffsetYrs,
      String noRegenLateOffsetYrs,
      String additionalStandards,
      String submittedByUserid,
      String mofDefaultStandardInd,
      String standardsAmendNumber,
      // Revision count of the standards_regime row — needed for the
      // SAVE optimistic-lock check. The save proc bumps it and the
      // post-save fetch surfaces the new value.
      String revisionCount,
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
