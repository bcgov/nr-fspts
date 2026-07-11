package ca.bc.gov.nrs.fsp.api.endpoint.v1;

import ca.bc.gov.nrs.fsp.api.constants.v1.URL;
import ca.bc.gov.nrs.fsp.api.security.FspAuthorities;
import ca.bc.gov.nrs.fsp.api.struct.v1.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

/**
 * Authentication is enforced at the JWT validation layer: every request is
 * guaranteed to carry at least one FSPTS role (see {@code FsptsRoleValidator}).
 *
 * <p>Authorization is role-scoped per endpoint. Read (GET) endpoints stay open
 * to any authenticated FSPTS role. Write endpoints (POST/PUT/DELETE) carry a
 * {@code @PreAuthorize} drawn from the capability matrix in
 * {@link FspAuthorities} — read-only roles (Reviewer, View-All, View-Only) are
 * denied with 403. Per-FSP ownership is enforced beneath this by the proc
 * tombstone fence.
 */
@RequestMapping(URL.BASE_URL)
@Tag(name = "FSP API", description = "Forest Stewardship Plan operations")
public interface FspApiEndpoint {

    // --- Code Lists (dropdown options) ---

    @GetMapping(URL.CODE_LISTS_ORG_UNITS)
    @Operation(summary = "List org units via FSP_CODE_LISTS.get_org_unit_filtered (unfiltered)")
    ResponseEntity<List<CodeOption>> getOrgUnits();

    @GetMapping(URL.CODE_LISTS_ORG_UNIT_CODES)
    @Operation(summary = "Org-unit lookup keyed by 3-letter org_unit_code (description = org_unit_name)")
    ResponseEntity<List<CodeOption>> getOrgUnitCodes();

    @GetMapping(URL.CODE_LISTS_FSP_STATUS)
    @Operation(summary = "List FSP status codes via FSP_CODE_LISTS.get_fsp_status_code")
    ResponseEntity<List<CodeOption>> getFspStatusCodes();

    @GetMapping(URL.CODE_LISTS_FSP_AMENDMENT_NUMBERS)
    @Operation(summary = "List amendment numbers for an FSP via FSP_CODE_LISTS.get_fsp_amendment_numbers")
    ResponseEntity<List<CodeOption>> getFspAmendmentNumbers(
            @RequestParam("fspId") String fspId);

    @GetMapping(URL.CODE_LISTS_SPECIES)
    @Operation(summary = "List silv tree species codes via FSP_CODE_LISTS.get_silv_tree_sp_cd")
    ResponseEntity<List<CodeOption>> getSilvTreeSpeciesCodes();

    @GetMapping(URL.CODE_LISTS_STATUTES)
    @Operation(summary = "List silv statute codes via FSP_CODE_LISTS.get_statute_cd (Regulation dropdown on FSP550)")
    ResponseEntity<List<CodeOption>> getStatuteCodes();

    // --- FSP ---

    @GetMapping(URL.FSP_SEARCH)
    @Operation(summary = "Search FSPs via FSP_100_SEARCH.MAINLINE (paginated + sorted in-memory)")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Search results returned"),
            @ApiResponse(responseCode = "401", description = "Unauthorized")
    })
    ResponseEntity<PageableResponse<FspSearchResult>> searchFsp(@Valid FspSearchRequest request);

    @GetMapping(URL.STANDARDS_SEARCH)
    @Operation(summary = "Search Stocking Standards (FSP501) via FSP_501_STDS_SRCH.MAINLINE")
    ResponseEntity<PageableResponse<StandardsSearchResult>> searchStandards(
            @Valid StandardsSearchRequest request);

    @GetMapping(URL.FSP_BY_ID)
    @Operation(summary = "Get FSP by ID via fsp_300_information.MAINLINE")
    ResponseEntity<FspRequest> getFspById(
            @PathVariable String fspId,
            @RequestParam(name = "amendmentNumber", required = false) String amendmentNumber);

    @PutMapping(URL.FSP_BY_ID)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary = "Update FSP via fsp_300_information.MAINLINE")
    ResponseEntity<FspRequest> updateFsp(
            @PathVariable String fspId, @Valid @RequestBody FspRequest fspRequest);

    @org.springframework.web.bind.annotation.DeleteMapping(URL.FSP_BY_ID)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary =
            "Delete a draft FSP via fsp_300_information.MAINLINE (P_ACTION=REMOVE). "
                    + "Proc rejects anything not in DFT or REJ status.")
    ResponseEntity<Void> deleteFsp(
            @PathVariable String fspId,
            @RequestParam(name = "amendmentNumber", required = false) String amendmentNumber);

    @PostMapping(URL.SUBMIT)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary =
            "Submit a draft FSP via fsp_300_information.MAINLINE (P_ACTION=SUBMIT). "
                    + "Proc runs validate_fsp first; missing required fields surface as "
                    + "FSP.* error codes and the status stays in DFT. On success the "
                    + "amendment transitions to SUB (or IN-EFFECT when "
                    + "approval_required_ind='N').")
    ResponseEntity<FspRequest> submitFsp(
            @PathVariable String fspId,
            @RequestParam(name = "amendmentNumber", required = false) String amendmentNumber);

    @GetMapping(URL.SUBMIT_PREFLIGHT)
    @Operation(summary =
            "Submit preflight — runs fsp_common_validation.validate_fsp without "
                    + "changing status. Returns the list of FSP.* validation issues "
                    + "(empty when the FSP would submit cleanly).")
    ResponseEntity<ca.bc.gov.nrs.fsp.api.struct.v1.SubmitPreflightResponse> submitPreflight(
            @PathVariable String fspId,
            @RequestParam(name = "amendmentNumber", required = false) String amendmentNumber);

    @PostMapping(URL.AMEND)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary =
            "Create a new amendment row on an existing FSP via "
                    + "fsp_300_information.MAINLINE(P_ACTION=AMEND). Returns the "
                    + "freshly-assigned amendment as an FspRequest DTO so the SPA "
                    + "can navigate to it.")
    ResponseEntity<FspRequest> amendFsp(@PathVariable String fspId);

    @PostMapping(URL.REPLACE)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary =
            "Create a new replacement amendment row on an existing FSP via "
                    + "fsp_300_information.MAINLINE(P_ACTION=REPLACE). Proc stamps "
                    + "fsp_amendment_code='RPL' and forces approval-required.")
    ResponseEntity<FspRequest> replaceFsp(@PathVariable String fspId);

    // --- Workflow ---

    @GetMapping(URL.WORKFLOW)
    @Operation(summary = "Get workflow audit cursor for an FSP")
    ResponseEntity<List<WorkflowResponse>> getWorkflow(@PathVariable String fspId);

    @GetMapping(URL.WORKFLOW_STATE)
    @Operation(summary = "Get the workflow milestone/decision projection via FSP_700_WORKFLOW.MAINLINE (GET)")
    ResponseEntity<WorkflowState> getWorkflowState(@PathVariable String fspId);

    @PostMapping(URL.WORKFLOW_ACTION)
    @PreAuthorize(FspAuthorities.WORKFLOW_DECISION)
    @Operation(summary = "Submit a workflow action via FSP_700_WORKFLOW.MAINLINE; returns the refreshed state")
    ResponseEntity<WorkflowState> submitWorkflowAction(
            @PathVariable String fspId, @Valid @RequestBody WorkflowRequest workflowRequest);

    // --- Stocking Standards ---

    @GetMapping(URL.STANDARDS)
    @Operation(summary = "Get stocking standards via FSP_500_STOCKING_STANDARDS.MAINLINE")
    ResponseEntity<List<StandardRequest>> getStandards(@PathVariable String fspId);

    @PutMapping(URL.STANDARDS)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary = "Replace stocking standards (currently a no-op pending DBA confirmation)")
    ResponseEntity<List<StandardRequest>> saveStandards(
            @PathVariable String fspId, @Valid @RequestBody List<StandardRequest> standards);

    @PostMapping(URL.STANDARDS)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary =
            "Create a new stocking-standards regime against the given FSP + "
                    + "amendment via FSP_550_STDS_PROPOSAL.SAVE (insert branch). "
                    + "Returns the freshly-assigned regime as a StandardRegimeDetail "
                    + "so the SPA can navigate straight to it.")
    ResponseEntity<ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeDetail> createStandardRegime(
            @PathVariable String fspId,
            @Valid @RequestBody ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeCreate body);

    @PostMapping(URL.STANDARD_COPY)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary =
            "Duplicate an existing stocking-standards regime on the same "
                    + "FSP + amendment via FSP_550_STDS_PROPOSAL.COPY. "
                    + "Returns the new regime as a StandardRegimeDetail.")
    ResponseEntity<ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeDetail> copyStandardRegime(
            @PathVariable String fspId,
            @PathVariable String regimeId,
            @RequestParam(name = "amendmentNumber", required = false) String amendmentNumber);

    @DeleteMapping(URL.STANDARD_BY_ID)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary = "Delete a stocking standard")
    ResponseEntity<Void> deleteStandard(
            @PathVariable String fspId, @PathVariable String standardId);

    // --- Attachments ---

    @GetMapping(URL.ATTACHMENTS)
    @Operation(summary = "List attachments via FSP_400_ATTACHMENTS.GET (flattened across categories)")
    ResponseEntity<List<AttachmentResponse>> getAttachments(@PathVariable String fspId);

    @GetMapping(URL.ATTACHMENT_CATEGORIES)
    @Operation(summary = "List attachment categories for an FSP via FSP_CODE_LISTS.get_attach_reference_list")
    ResponseEntity<List<CodeOption>> getAttachmentCategories(@PathVariable String fspId);

    @PostMapping(value = URL.ATTACHMENTS, consumes = "multipart/form-data")
    @PreAuthorize(FspAuthorities.ATTACHMENT_EDIT)
    @Operation(summary = "Upload an attachment via FSP_400_ATTACHMENTS.CREATE_ATTACHMENT + SAVE_ATTACHMENT_CONTENT")
    ResponseEntity<AttachmentResponse> uploadAttachment(
            @PathVariable String fspId,
            @RequestParam("file") MultipartFile file,
            @RequestParam("typeCode") String typeCode,
            @RequestParam(name = "description", required = false) String description)
            throws IOException;

    @GetMapping(URL.ATTACHMENT_DOWNLOAD)
    @Operation(summary = "Download an attachment via FSP_400_ATTACHMENTS.GET_ATTACH_BLOB")
    ResponseEntity<byte[]> downloadAttachment(
            @PathVariable String fspId, @PathVariable Long attachmentId);

    @DeleteMapping(URL.ATTACHMENT_BY_ID)
    @PreAuthorize(FspAuthorities.ATTACHMENT_EDIT)
    @Operation(summary = "Delete an attachment via FSP_400_ATTACHMENTS.REMOVE_ATTACHMENT")
    ResponseEntity<Void> deleteAttachment(
            @PathVariable String fspId, @PathVariable Long attachmentId);

    // --- Inbox ---

    @GetMapping(URL.INBOX)
    @Operation(summary = "Get inbox items via fsp_200_inbox.MAINLINE (paginated + sorted in-memory)")
    ResponseEntity<PageableResponse<FspSearchResult>> getInbox(@Valid InboxRequest request);

    // --- History ---

    @GetMapping(URL.HISTORY)
    @Operation(summary = "Get audit history via FSP_800_HISTORY.MAINLINE")
    ResponseEntity<List<WorkflowResponse>> getHistory(@PathVariable String fspId);

    // --- Extension Summary ---

    @GetMapping(URL.EXTENSIONS)
    @Operation(summary = "Get extension summary via FSP_303_EXTENSION_SUMMARY.GET_LIST")
    ResponseEntity<ExtensionSummary> getExtensions(@PathVariable String fspId);

    @PostMapping(URL.EXTENSIONS)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary = "Create a new extension request via FSP_302_EXTENSION_REQUEST.SAVE")
    ResponseEntity<ExtensionRequestSaved> createExtension(
            @PathVariable String fspId,
            @Valid @RequestBody ExtensionRequestSave body);

    // --- FDU list (Map tab) ---

    @GetMapping(URL.FDU_LIST)
    @Operation(summary = "Get the per-FDU list via FSP_600_MAP.GET")
    ResponseEntity<FduList> getFduList(@PathVariable String fspId);

    @PutMapping(URL.FDU_LICENCES)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary =
            "Apply licence additions/removals to an FDU. Status-gated: "
                    + "DFT writable by submitters, APP writable by administrators only.")
    ResponseEntity<FduLicencesUpdated> updateFduLicences(
            @PathVariable String fspId,
            @PathVariable long fduId,
            @Valid @RequestBody FduLicencesUpdate body);

    @GetMapping(URL.LICENCE_EXISTS)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary =
            "Check whether a licence number exists in PROV_FOREST_USE — "
                    + "backs the Edit-licences dialog's Add-time validation.")
    ResponseEntity<LicenceExistsResponse> licenceExists(
            @PathVariable String fspId,
            @RequestParam("licenceNumber") String licenceNumber);

    // --- Stocking Standards detail (FSP250 view-only) ---

    @GetMapping(URL.STANDARD_DETAIL)
    @Operation(summary = "Get standards regime detail via FSP_550_STDS_PROPOSAL.GET")
    ResponseEntity<StandardRegimeDetail> getStandardRegimeDetail(
            @PathVariable String fspId,
            @PathVariable String regimeId,
            @RequestParam(name = "amendmentNumber", required = false) String amendmentNumber);

    @GetMapping(URL.STANDARD_REGIME_DETAIL)
    @Operation(summary = "Get standards regime detail with regime-scoped org/clients (no FSP context)")
    ResponseEntity<StandardRegimeDetail> getStandardRegimeDetailByRegime(
            @PathVariable String regimeId);

    @PutMapping(URL.STANDARD_OVERVIEW)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary = "Save standards regime Overview-tab edits via FSP_550_STDS_PROPOSAL.SAVE")
    ResponseEntity<StandardRegimeDetail> updateStandardRegimeOverview(
            @PathVariable String fspId,
            @PathVariable String regimeId,
            @RequestParam(name = "amendmentNumber", required = false) String amendmentNumber,
            @Valid @RequestBody StandardRegimeOverviewUpdate body);

    @GetMapping(URL.STANDARD_LAYER_DETAIL)
    @Operation(summary = "Get per-layer detail (FSP_550_SUB_LAYERS + FSP_550_SUB_SPECIES)")
    ResponseEntity<StandardRegimeLayerDetail> getStandardRegimeLayerDetail(
            @PathVariable String fspId,
            @PathVariable String regimeId,
            @PathVariable String layerCode,
            @RequestParam(name = "layerId") String layerId);

    @GetMapping(URL.STANDARD_REGIME_LAYER_DETAIL)
    @Operation(summary = "Get per-layer detail (no FSP context — used by standards-search dialog)")
    ResponseEntity<StandardRegimeLayerDetail> getStandardRegimeLayerDetailByRegime(
            @PathVariable String regimeId,
            @PathVariable String layerCode,
            @RequestParam(name = "layerId") String layerId);

    @PutMapping(URL.STANDARD_LAYER_DETAIL)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary = "Save layer scalar fields via FSP_550_SUB_LAYERS.MAINLINE(SAVE); omit layerId to ADD a brand-new layer")
    ResponseEntity<StandardRegimeLayerDetail> updateStandardRegimeLayer(
            @PathVariable String fspId,
            @PathVariable String regimeId,
            @PathVariable String layerCode,
            @RequestParam(name = "layerId", required = false) String layerId,
            @RequestParam(name = "amendmentNumber", required = false) String amendmentNumber,
            @Valid @RequestBody StandardRegimeLayerUpdate body);

    @PostMapping(URL.STANDARD_LAYER_SPECIES)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary = "Add a species row to a layer (preferred or acceptable) via FSP_550_SUB_SPECIES.MAINLINE(SAVE)")
    ResponseEntity<StandardRegimeLayerDetail> addStandardRegimeLayerSpecies(
            @PathVariable String fspId,
            @PathVariable String regimeId,
            @PathVariable String layerCode,
            @RequestParam(name = "layerId") String layerId,
            @Valid @RequestBody StandardRegimeLayerSpeciesAdd body);

    @DeleteMapping(URL.STANDARD_LAYER_SPECIES_BY_CODE)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary = "Delete a species row from a layer via FSP_550_SUB_SPECIES.MAINLINE(DELETE)")
    ResponseEntity<StandardRegimeLayerDetail> deleteStandardRegimeLayerSpecies(
            @PathVariable String fspId,
            @PathVariable String regimeId,
            @PathVariable String layerCode,
            @PathVariable String speciesCode,
            @RequestParam(name = "layerId") String layerId,
            @RequestParam(name = "preferred") String preferred,
            @RequestParam(name = "revisionCount") String revisionCount);

    @PostMapping(URL.STANDARD_LAYERS_CONVERT)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary = "Toggle between single-layer and multi-layer via FSP_550_SUB_LAYERS.MAINLINE(CONVERT_LAYERS)")
    ResponseEntity<StandardRegimeDetail> convertStandardRegimeLayers(
            @PathVariable String fspId,
            @PathVariable String regimeId,
            @RequestParam(name = "amendmentNumber", required = false) String amendmentNumber);

    @PostMapping(URL.STANDARD_BGC_ZONES)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary = "Add a BGC site-series row via FSP_550_STDS_PROPOSAL.SAVE_BGC_ITEM")
    ResponseEntity<StandardRegimeDetail> addStandardRegimeBgcZone(
            @PathVariable String fspId,
            @PathVariable String regimeId,
            // Needed by the re-read after save — FSP_550_STDS_PROPOSAL.GET
            // does an unguarded SELECT INTO on FOREST_STEWARDSHIP_PLAN by
            // (fsp_id, amendment_number); missing amendment ⇒ NO_DATA_FOUND ⇒ noRecord.
            @RequestParam(name = "amendmentNumber", required = false) String amendmentNumber,
            @Valid @RequestBody StandardRegimeBgcZoneUpsert body);

    @DeleteMapping(URL.STANDARD_BGC_ZONE_BY_ID)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary = "Delete a BGC site-series row via FSP_550_STDS_PROPOSAL.REMOVE_BGC_ITEM")
    ResponseEntity<StandardRegimeDetail> deleteStandardRegimeBgcZone(
            @PathVariable String fspId,
            @PathVariable String regimeId,
            @PathVariable String siteSeriesId,
            @RequestParam(name = "revisionCount") String revisionCount,
            @RequestParam(name = "amendmentNumber", required = false) String amendmentNumber);

    @PutMapping(URL.STANDARD_BGC_ZONE_BY_ID)
    @PreAuthorize(FspAuthorities.CONTENT_EDIT)
    @Operation(summary = "Update a BGC site-series row via FSP_550_STDS_PROPOSAL.SAVE_BGC_ITEM")
    ResponseEntity<StandardRegimeDetail> updateStandardRegimeBgcZone(
            @PathVariable String fspId,
            @PathVariable String regimeId,
            @PathVariable String siteSeriesId,
            @RequestParam(name = "revisionCount") String revisionCount,
            @RequestParam(name = "amendmentNumber", required = false) String amendmentNumber,
            @Valid @RequestBody StandardRegimeBgcZoneUpsert body);

    // --- Map View extent ---

    @GetMapping(URL.EXTENT)
    @Operation(summary = "Compute Map View MBR (minX,minY,maxX,maxY) over fdu_geometry_gets polygons")
    ResponseEntity<FspExtentResponse> getExtent(
            @PathVariable String fspId, @PathVariable String amendmentNumber);

    // --- District Auto-Notification (Admin) ---

    @GetMapping(URL.DISTRICT_DESIGNATES)
    @Operation(summary = "List IDIR designates CC'd on FSP-200 notifications for an org unit")
    ResponseEntity<List<NotificationDesignate>> getDistrictDesignates(
            @RequestParam(name = "orgUnitNo") String orgUnitNo);

    @PostMapping(URL.DISTRICT_DESIGNATES)
    @PreAuthorize(FspAuthorities.ADMINISTRATOR)
    @Operation(summary = "Add an IDIR designate to an org unit's notification list")
    ResponseEntity<Void> addDistrictDesignate(@Valid @RequestBody NotificationDesignate body);

    @DeleteMapping(URL.DISTRICT_DESIGNATE_BY_ID)
    @PreAuthorize(FspAuthorities.ADMINISTRATOR)
    @Operation(summary = "Remove a district notification designate by id")
    ResponseEntity<Void> removeDistrictDesignate(@PathVariable String designateId);

    // --- IDIR directory lookup (nr-user-lookup-api) ---

    @GetMapping(URL.USER_SEARCH)
    @Operation(summary = "Search IDIR users via nr-user-lookup-api")
    ResponseEntity<UserSearchResponse> searchUsers(
            @RequestParam(name = "userId", required = false) String userId,
            @RequestParam(name = "firstName", required = false) String firstName,
            @RequestParam(name = "lastName", required = false) String lastName,
            @RequestParam(name = "size", required = false, defaultValue = "0") int size);
}
