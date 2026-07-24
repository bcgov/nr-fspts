package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.util.List;

/**
 * Wraps THE.FSP_550_STDS_PROPOSAL.GET — the legacy FSP250 ("Standards
 * View") detail proc. Reads a single standards regime by id plus four
 * related cursors (org units, clients, BGC zones). The
 * proc carries write-mode actions too (ADD/SAVE/COPY/REMOVE) but only
 * the read path is wrapped here.
 */
public interface Fsp550StdsProposalDao {

  String PACKAGE_NAME = "FSP_550_STDS_PROPOSAL";
  String PROCEDURE_NAME = "GET";
  String PROCEDURE_SAVE = "SAVE";
  String PROCEDURE_SAVE_BGC_ITEM = "SAVE_BGC_ITEM";
  String PROCEDURE_REMOVE_BGC_ITEM = "REMOVE_BGC_ITEM";
  String PROCEDURE_REMOVE = "REMOVE";
  String PROCEDURE_COPY = "COPY";
  String PROCEDURE_ASSOC = "ASSOC_FSP_TO_STD_REGIME";
  String PROCEDURE_UNLINK = "UNLINK_DEFAULT_STANDARDS";
  // Standards-regime attachment procs (STANDARDS_REGIME_ATTACHMENT +
  // STANDARDS_REGIME_ATTACH_FILE). The add path is the legacy two-step
  // BLOB pattern: GET_ATTACHMENT_BLOB_FOR_UPDATE creates the metadata
  // row (empty BLOB) and returns the assigned id + revision, then
  // SAVE_ATTACHMENT writes the file bytes into the BLOB and finalises.
  String PROCEDURE_GET_ATTACHMENT_BLOB = "GET_ATTACHMENT_BLOB";
  String PROCEDURE_ADD_ATTACHMENT = "GET_ATTACHMENT_BLOB_FOR_UPDATE";
  String PROCEDURE_SAVE_ATTACHMENT = "SAVE_ATTACHMENT";
  String PROCEDURE_REMOVE_ATTACHMENT = "REMOVE_ATTACHMENT";

  /**
   * @param displayFspOrgClients {@code "Y"} scopes the org-unit + client
   *     cursors to the FSP (requires a valid {@code fspId} +
   *     {@code amendmentNumber}); {@code "N"} returns the regime's own
   *     org-units + clients independent of any FSP context.
   */
  Result get(String regimeId, String fspId, String amendmentNumber,
             String displayFspOrgClients);

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
   * Wraps {@code FSP_550_STDS_PROPOSAL.REMOVE_BGC_ITEM}. Deletes one
   * row of STANDARDS_REGIME_SITE_SERIES by id; the row's
   * revision_count is required for the proc's optimistic-lock check,
   * and the parent regime's revision_count is bumped by
   * update_audit_info on success.
   */
  void removeBgcItem(RemoveBgcRequest req);

  record RemoveBgcRequest(
      String stdsRegimeSiteSeriesId,
      String standardsRegimeId,
      String updateUserid,
      String revisionCount,           // row-level optimistic-lock token
      String standardsRevisionCount   // parent regime revision, bumped on success
  ) {}

  /**
   * Wraps {@code FSP_550_STDS_PROPOSAL.REMOVE}. Deletes an entire
   * standards regime and all of its child rows (layers, species, org
   * units, clients, attachments, BGC site series, and the FSP xref).
   * The final {@code DELETE} on STANDARDS_REGIME is guarded by
   * {@code revision_count = p_revision_count}; a mismatch (someone else
   * edited the regime meanwhile) surfaces as the proc's
   * "modified record" error.
   */
  void removeRegime(RemoveRequest req);

  record RemoveRequest(
      String standardsRegimeId,
      String standardsRegimeStatusCode, // referenced only by the proc's audit hook
      String updateUserid,
      String revisionCount              // optimistic-lock token
  ) {}

  /**
   * Wraps {@code FSP_550_STDS_PROPOSAL.COPY}. Duplicates an existing
   * standards regime onto the same FSP / amendment so the user can
   * tweak the copy without losing the original. The proc assigns a
   * new STANDARDS_REGIME_ID and copies all child rows (layers,
   * species, BGC site series, etc.).
   *
   * <p>{@code orgUnitNo} and {@code clientNumber} are the legacy
   * session-context values the proc associates with the new regime.
   * Pass empty strings to let the proc inherit from the source row.</p>
   */
  CopyResult copyRegime(CopyRequest req);

  record CopyRequest(
      String sourceRegimeId,
      String fspId,
      String fspAmendmentNumber,
      String orgUnitNo,
      String clientNumber,
      String updateUserid,
      String revisionCount
  ) {}

  record CopyResult(String newRegimeId, String errorMessage) {}

  /**
   * Wraps {@code FSP_550_STDS_PROPOSAL.ASSOC_FSP_TO_STD_REGIME} — the
   * legacy "Add default standard" action. LINKS an existing (shared, MoF
   * default) standards regime to this FSP/amendment by inserting a
   * FSP_STANDARDS_REGIME_XREF row; it does NOT copy the regime. The proc
   * validates the regime's org unit is one of the FSP's org units before
   * linking. The counterpart of {@link #unlinkDefault(UnlinkRequest)}.
   */
  void assocRegime(AssocRequest req);

  record AssocRequest(
      String fspId,
      String fspAmendmentNumber,
      String standardsRegimeId,
      String updateUserid
  ) {}

  /**
   * Wraps {@code FSP_550_STDS_PROPOSAL.UNLINK_DEFAULT_STANDARDS} — the
   * legacy "Unlink Default Standard" action. Removes ONLY the
   * FSP_STANDARDS_REGIME_XREF row tying the (shared) default regime to
   * this FSP; the regime itself and its children are left intact (unlike
   * {@link #removeRegime(RemoveRequest)}, which tears the whole regime
   * down). Only valid for MoF default standards.
   */
  void unlinkDefault(UnlinkRequest req);

  record UnlinkRequest(
      String fspId,
      String fspAmendmentNumber,
      String standardsRegimeId
  ) {}

  // -----------------------------------------------------------------
  // Standards-regime attachment write/read paths.
  // -----------------------------------------------------------------

  /**
   * Download one attachment's bytes via
   * {@code FSP_550_STDS_PROPOSAL.GET_ATTACHMENT_BLOB}.
   */
  AttachBlob getAttachmentBlob(String attachId);

  record AttachBlob(String attachId, String fileName, byte[] content, String errorMessage) {}

  /**
   * Step 1 of the two-step add: create the STANDARDS_REGIME_ATTACHMENT
   * metadata row (with an empty BLOB) via
   * {@code GET_ATTACHMENT_BLOB_FOR_UPDATE} and return the freshly
   * assigned attach id + revision_count (=1). Pass the mime type code
   * ({@code mimeTypeCode}); an unknown code is stored as NULL by the
   * proc (the column is nullable), never an error.
   */
  AddAttachmentResult addAttachment(
      String regimeId, String attachmentName, String description,
      String mimeTypeCode, String mimeType, String userId);

  record AddAttachmentResult(String attachId, String revisionCount, String errorMessage) {}

  /**
   * Step 2 of the two-step add: write the file bytes into the row's
   * BLOB and finalise via {@code SAVE_ATTACHMENT} (which updates the
   * attach file, bumps the attachment revision, and re-audits the
   * parent regime). Must run in the same transaction as
   * {@link #addAttachment}.
   */
  String saveAttachment(
      String attachId, String regimeId, String attachmentName, String description,
      String mimeTypeCode, String mimeType, byte[] content, String userId,
      String revisionCount, String standardsRevisionCount);

  /**
   * Delete one attachment (metadata + file rows) via
   * {@code REMOVE_ATTACHMENT}. {@code revisionCount} is the attachment
   * row's optimistic-lock token; {@code standardsRevisionCount} is the
   * parent regime's, bumped by the proc's audit hook on success.
   */
  String removeAttachment(
      String attachId, String regimeId, String userId,
      String revisionCount, String standardsRevisionCount);

  /**
   * Lightweight lookup of a single attachment row's revision_count —
   * used by the delete path so the caller doesn't have to thread the
   * token from the front-end. Returns {@code null} when the id is
   * unknown.
   */
  String getAttachmentRevisionCount(String attachId);

  /** The cursor lists + the scalar header row. */
  record Result(
      Header header,
      List<OrgUnitRow> districts,
      List<ClientRow> clients,
      List<BgcZoneRow> bgcZones,
      List<AttachmentRow> attachments,
      String errorMessage
  ) {}

  /**
   * Single row of p_attachment_cursor (STANDARDS_REGIME_ATTACHMENT ⋈
   * STANDARDS_REGIME_ATTACH_FILE). {@code fileSize} is the proc's
   * pre-formatted KB string ("999,990.00"); {@code revisionCount}
   * is the optimistic-lock token for delete.
   */
  record AttachmentRow(
      String standardsRegimeId,
      String standardsRegimeAttachId,
      String attachmentName,
      String attachmentDescription,
      String mimeTypeCode,
      String fileSize,
      String revisionCount
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

  record BgcZoneRow(
      // STANDARD_REGIME_SITE_SERIES_ID (PK) — needed for SAVE/REMOVE.
      String stdsRegimeSiteSeriesId,
      String bgcZoneCode,
      String bgcSubzoneCode,
      String bgcVariant,
      String bgcPhase,
      String becSiteSeriesCd,
      String becSiteSeriesPhaseCd,
      String becSeral,
      // Row-level optimistic-lock token for SAVE/REMOVE.
      String revisionCount
  ) {}
}
