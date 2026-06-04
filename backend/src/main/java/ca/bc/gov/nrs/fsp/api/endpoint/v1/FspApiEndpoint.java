package ca.bc.gov.nrs.fsp.api.endpoint.v1;

import ca.bc.gov.nrs.fsp.api.constants.v1.URL;
import ca.bc.gov.nrs.fsp.api.struct.v1.*;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

/**
 * Authorization is enforced at the JWT validation layer: every authenticated
 * request is guaranteed to carry at least one FSPTS role (see
 * {@code FsptsRoleValidator}). For now any FSPTS role can hit any endpoint;
 * per-role {@code @PreAuthorize("hasRole('FSPTS_*')")} checks will be added
 * when role-scoped access is finalized.
 */
@RequestMapping(URL.BASE_URL)
@Tag(name = "FSP API", description = "Forest Stewardship Plan operations")
public interface FspApiEndpoint {

    // --- Code Lists (dropdown options) ---

    @GetMapping(URL.CODE_LISTS_ORG_UNITS)
    @Operation(summary = "List org units via FSP_CODE_LISTS.get_org_unit_filtered (unfiltered)")
    ResponseEntity<List<CodeOption>> getOrgUnits();

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

    // --- FSP ---

    @GetMapping(URL.FSP_SEARCH)
    @Operation(summary = "Search FSPs via FSP_100_SEARCH.MAINLINE (paginated + sorted in-memory)")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Search results returned"),
            @ApiResponse(responseCode = "401", description = "Unauthorized")
    })
    ResponseEntity<PageableResponse<FspSearchResult>> searchFsp(@Valid FspSearchRequest request);

    @GetMapping(URL.FSP_BY_ID)
    @Operation(summary = "Get FSP by ID via fsp_300_information.MAINLINE")
    ResponseEntity<FspRequest> getFspById(
            @PathVariable String fspId,
            @RequestParam(name = "amendmentNumber", required = false) String amendmentNumber);

    @PutMapping(URL.FSP_BY_ID)
    @Operation(summary = "Update FSP via fsp_300_information.MAINLINE")
    ResponseEntity<FspRequest> updateFsp(
            @PathVariable String fspId, @Valid @RequestBody FspRequest fspRequest);

    // --- Workflow ---

    @GetMapping(URL.WORKFLOW)
    @Operation(summary = "Get workflow audit cursor for an FSP")
    ResponseEntity<List<WorkflowResponse>> getWorkflow(@PathVariable String fspId);

    @GetMapping(URL.WORKFLOW_STATE)
    @Operation(summary = "Get the workflow milestone/decision projection via FSP_700_WORKFLOW.MAINLINE (GET)")
    ResponseEntity<WorkflowState> getWorkflowState(@PathVariable String fspId);

    @PostMapping(URL.WORKFLOW_ACTION)
    @Operation(summary = "Submit a workflow action via FSP_700_WORKFLOW.MAINLINE")
    ResponseEntity<Void> submitWorkflowAction(
            @PathVariable String fspId, @Valid @RequestBody WorkflowRequest workflowRequest);

    // --- Stocking Standards ---

    @GetMapping(URL.STANDARDS)
    @Operation(summary = "Get stocking standards via FSP_500_STOCKING_STANDARDS.MAINLINE")
    ResponseEntity<List<StandardRequest>> getStandards(@PathVariable String fspId);

    @PutMapping(URL.STANDARDS)
    @Operation(summary = "Replace stocking standards (currently a no-op pending DBA confirmation)")
    ResponseEntity<List<StandardRequest>> saveStandards(
            @PathVariable String fspId, @Valid @RequestBody List<StandardRequest> standards);

    @DeleteMapping(URL.STANDARD_BY_ID)
    @Operation(summary = "Delete a stocking standard")
    ResponseEntity<Void> deleteStandard(
            @PathVariable String fspId, @PathVariable String standardId);

    // --- Attachments ---

    @GetMapping(URL.ATTACHMENTS)
    @Operation(summary = "List attachments via FSP_400_ATTACHMENTS.GET (flattened across categories)")
    ResponseEntity<List<AttachmentResponse>> getAttachments(@PathVariable String fspId);

    @PostMapping(value = URL.ATTACHMENTS, consumes = "multipart/form-data")
    @Operation(summary = "Upload an attachment via FSP_400_ATTACHMENTS.CREATE_ATTACHMENT + SAVE_ATTACHMENT_CONTENT")
    ResponseEntity<AttachmentResponse> uploadAttachment(
            @PathVariable String fspId,
            @RequestParam("file") MultipartFile file,
            @RequestParam("typeCode") String typeCode) throws IOException;

    @GetMapping(URL.ATTACHMENT_DOWNLOAD)
    @Operation(summary = "Download an attachment via FSP_400_ATTACHMENTS.GET_ATTACH_BLOB")
    ResponseEntity<byte[]> downloadAttachment(
            @PathVariable String fspId, @PathVariable Long attachmentId);

    @DeleteMapping(URL.ATTACHMENT_BY_ID)
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

    // --- FDU list (Map tab) ---

    @GetMapping(URL.FDU_LIST)
    @Operation(summary = "Get the per-FDU list via FSP_600_MAP.GET")
    ResponseEntity<FduList> getFduList(@PathVariable String fspId);

    @GetMapping(URL.IDENTIFIED_AREAS)
    @Operation(summary = "Get identified areas (all FRPA/FPPR sections combined) via FSP_650_IDENTIFIED_AREAS_MAP.GET")
    ResponseEntity<IdentifiedAreaList> getIdentifiedAreas(@PathVariable String fspId);

    // --- Stocking Standards detail (FSP250 view-only) ---

    @GetMapping(URL.STANDARD_DETAIL)
    @Operation(summary = "Get standards regime detail via FSP_550_STDS_PROPOSAL.GET")
    ResponseEntity<StandardRegimeDetail> getStandardRegimeDetail(
            @PathVariable String fspId,
            @PathVariable String regimeId,
            @RequestParam(name = "amendmentNumber", required = false) String amendmentNumber);

    @PutMapping(URL.STANDARD_OVERVIEW)
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

    @PutMapping(URL.STANDARD_LAYER_DETAIL)
    @Operation(summary = "Save layer scalar fields via FSP_550_SUB_LAYERS.MAINLINE(SAVE)")
    ResponseEntity<StandardRegimeLayerDetail> updateStandardRegimeLayer(
            @PathVariable String fspId,
            @PathVariable String regimeId,
            @PathVariable String layerCode,
            @RequestParam(name = "layerId") String layerId,
            @Valid @RequestBody StandardRegimeLayerUpdate body);

    @PostMapping(URL.STANDARD_LAYER_SPECIES)
    @Operation(summary = "Add a species row to a layer (preferred or acceptable) via FSP_550_SUB_SPECIES.MAINLINE(SAVE)")
    ResponseEntity<StandardRegimeLayerDetail> addStandardRegimeLayerSpecies(
            @PathVariable String fspId,
            @PathVariable String regimeId,
            @PathVariable String layerCode,
            @RequestParam(name = "layerId") String layerId,
            @Valid @RequestBody StandardRegimeLayerSpeciesAdd body);

    @DeleteMapping(URL.STANDARD_LAYER_SPECIES_BY_CODE)
    @Operation(summary = "Delete a species row from a layer via FSP_550_SUB_SPECIES.MAINLINE(DELETE)")
    ResponseEntity<StandardRegimeLayerDetail> deleteStandardRegimeLayerSpecies(
            @PathVariable String fspId,
            @PathVariable String regimeId,
            @PathVariable String layerCode,
            @PathVariable String speciesCode,
            @RequestParam(name = "layerId") String layerId,
            @RequestParam(name = "preferred") String preferred,
            @RequestParam(name = "revisionCount") String revisionCount);

    @GetMapping(URL.STANDARD_ATTACHMENT_DOWNLOAD)
    @Operation(summary = "Download a standards-regime attachment BLOB via FSP_550_STDS_PROPOSAL.GET_ATTACHMENT_BLOB")
    ResponseEntity<byte[]> downloadStandardRegimeAttachment(
            @PathVariable String fspId,
            @PathVariable String regimeId,
            @PathVariable String attachmentId);

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
    @Operation(summary = "Add an IDIR designate to an org unit's notification list")
    ResponseEntity<Void> addDistrictDesignate(@Valid @RequestBody NotificationDesignate body);

    @DeleteMapping(URL.DISTRICT_DESIGNATE_BY_ID)
    @Operation(summary = "Remove a district notification designate by id")
    ResponseEntity<Void> removeDistrictDesignate(@PathVariable String designateId);

    // --- FAM IDIR directory lookup ---

    @GetMapping(URL.USER_SEARCH)
    @Operation(summary = "Search IDIR users via the FAM identity-lookup API")
    ResponseEntity<UserSearchResponse> searchUsers(
            @RequestParam(name = "userId", required = false) String userId,
            @RequestParam(name = "firstName", required = false) String firstName,
            @RequestParam(name = "lastName", required = false) String lastName,
            @RequestParam(name = "size", required = false, defaultValue = "0") int size);
}
