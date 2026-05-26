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
    ResponseEntity<FspRequest> getFspById(@PathVariable String fspId);

    @PutMapping(URL.FSP_BY_ID)
    @Operation(summary = "Update FSP via fsp_300_information.MAINLINE")
    ResponseEntity<FspRequest> updateFsp(
            @PathVariable String fspId, @Valid @RequestBody FspRequest fspRequest);

    // --- Workflow ---

    @GetMapping(URL.WORKFLOW)
    @Operation(summary = "Get workflow audit cursor for an FSP")
    ResponseEntity<List<WorkflowResponse>> getWorkflow(@PathVariable String fspId);

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
    @Operation(summary = "Get inbox items via fsp_200_inbox.MAINLINE")
    ResponseEntity<List<FspSearchResult>> getInbox();

    // --- History ---

    @GetMapping(URL.HISTORY)
    @Operation(summary = "Get audit history via FSP_800_HISTORY.MAINLINE")
    ResponseEntity<List<WorkflowResponse>> getHistory(@PathVariable String fspId);
}
