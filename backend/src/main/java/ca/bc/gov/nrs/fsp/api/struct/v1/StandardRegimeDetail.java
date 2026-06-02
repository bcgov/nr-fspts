package ca.bc.gov.nrs.fsp.api.struct.v1;

import java.util.List;

/**
 * Read-only projection of FSP_550_STDS_PROPOSAL.GET — backs the FSP250
 * "Standards View" detail panel. Surfaces a subset of the proc's full
 * scalar set + four related lists (districts, clients, attachments,
 * bgc zones). Layer/species detail is intentionally out-of-scope here.
 */
public record StandardRegimeDetail(
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
    /** Layer presence — one entry per existing layer (single/1/2/3/4). */
    List<LayerSummary> layers,
    List<District> districts,
    List<AgreementHolder> agreementHolders,
    List<Attachment> attachments,
    List<BgcZone> bgcZones
) {

  /**
   * Identifies a layer the regime has data for. {@code layerCode} is
   * the value the proc expects (I = single, 1 = mature, 2 = pole,
   * 3 = sapling, 4 = regen); {@code layerId} is the regime_layer_id
   * keyed by FSP_550_SUB_LAYERS / FSP_550_SUB_SPECIES.
   */
  public record LayerSummary(String layerCode, String layerId) {}

  public record District(String orgUnitNo, String orgUnitCode, String orgUnitName) {}

  public record AgreementHolder(String clientNumber, String clientName, String clientAcronym) {}

  public record Attachment(
      String attachmentId,
      String attachmentName,
      String attachmentDescription,
      String mimeTypeCode,
      String fileSize
  ) {}

  public record BgcZone(
      String bgcZoneCode,
      String bgcSubzoneCode,
      String bgcVariant,
      String bgcPhase,
      String becSiteSeriesCd,
      String becSiteSeriesPhaseCd,
      String becSeral
  ) {}
}
