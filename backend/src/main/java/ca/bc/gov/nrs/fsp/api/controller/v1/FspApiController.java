package ca.bc.gov.nrs.fsp.api.controller.v1;

import ca.bc.gov.nrs.fsp.api.endpoint.v1.FspApiEndpoint;
import ca.bc.gov.nrs.fsp.api.service.v1.*;
import ca.bc.gov.nrs.fsp.api.struct.v1.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

@RestController
@Slf4j
public class FspApiController implements FspApiEndpoint {

    private final FspService fspService;
    private final StandardsSearchService standardsSearchService;
    private final WorkflowService workflowService;
    private final StandardsService standardsService;
    private final AttachmentsService attachmentsService;
    private final InboxService inboxService;
    private final HistoryService historyService;
    private final ExtensionService extensionService;
    private final FduService fduService;
    private final StandardRegimeService standardRegimeService;
    private final CodeListsService codeListsService;
    private final FspExtentService fspExtentService;
    private final DistrictNotificationService districtNotificationService;
    private final UserDirectoryService userDirectoryService;

    public FspApiController(FspService fspService,
                            StandardsSearchService standardsSearchService,
                            WorkflowService workflowService,
                            StandardsService standardsService, AttachmentsService attachmentsService,
                            InboxService inboxService, HistoryService historyService,
                            ExtensionService extensionService,
                            FduService fduService,
                            StandardRegimeService standardRegimeService,
                            CodeListsService codeListsService, FspExtentService fspExtentService,
                            DistrictNotificationService districtNotificationService,
                            UserDirectoryService userDirectoryService) {
        this.fspService = fspService;
        this.standardsSearchService = standardsSearchService;
        this.workflowService = workflowService;
        this.standardsService = standardsService;
        this.attachmentsService = attachmentsService;
        this.inboxService = inboxService;
        this.historyService = historyService;
        this.extensionService = extensionService;
        this.fduService = fduService;
        this.standardRegimeService = standardRegimeService;
        this.codeListsService = codeListsService;
        this.fspExtentService = fspExtentService;
        this.districtNotificationService = districtNotificationService;
        this.userDirectoryService = userDirectoryService;
    }

    // --- Code Lists (dropdown options) ---

    @Override
    public ResponseEntity<List<CodeOption>> getOrgUnits() {
        return ResponseEntity.ok(codeListsService.getOrgUnits());
    }

    @Override
    public ResponseEntity<List<CodeOption>> getOrgUnitCodes() {
        return ResponseEntity.ok(codeListsService.getOrgUnitCodes());
    }

    @Override
    public ResponseEntity<List<CodeOption>> getFspStatusCodes() {
        return ResponseEntity.ok(codeListsService.getFspStatusCodes());
    }

    @Override
    public ResponseEntity<List<CodeOption>> getFspAmendmentNumbers(String fspId) {
        return ResponseEntity.ok(codeListsService.getFspAmendmentNumbers(fspId));
    }

    @Override
    public ResponseEntity<List<CodeOption>> getSilvTreeSpeciesCodes() {
        return ResponseEntity.ok(codeListsService.getSilvTreeSpeciesCodes());
    }

    @Override
    public ResponseEntity<List<CodeOption>> getStatuteCodes() {
        return ResponseEntity.ok(codeListsService.getStatuteCodes());
    }

    // --- FSP ---

    @Override
    public ResponseEntity<PageableResponse<FspSearchResult>> searchFsp(FspSearchRequest request) {
        return ResponseEntity.ok(fspService.search(request));
    }

    @Override
    public ResponseEntity<PageableResponse<StandardsSearchResult>> searchStandards(
            StandardsSearchRequest request) {
        return ResponseEntity.ok(standardsSearchService.search(request));
    }

    @Override
    public ResponseEntity<FspRequest> getFspById(String fspId, String amendmentNumber) {
        return ResponseEntity.ok(fspService.getById(fspId, amendmentNumber));
    }

    @Override
    public ResponseEntity<FspRequest> updateFsp(String fspId, FspRequest fspRequest) {
        return ResponseEntity.ok(fspService.update(fspId, fspRequest));
    }

    @Override
    public ResponseEntity<Void> deleteFsp(String fspId, String amendmentNumber) {
        fspService.delete(fspId, amendmentNumber);
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<FspRequest> submitFsp(String fspId, String amendmentNumber) {
        return ResponseEntity.ok(fspService.submit(fspId, amendmentNumber));
    }

    @Override
    public ResponseEntity<ca.bc.gov.nrs.fsp.api.struct.v1.SubmitPreflightResponse> submitPreflight(
            String fspId, String amendmentNumber) {
        return ResponseEntity.ok(fspService.preflightSubmit(fspId, amendmentNumber));
    }

    @Override
    public ResponseEntity<FspRequest> amendFsp(String fspId) {
        return ResponseEntity.ok(fspService.amend(fspId, new FspRequest()));
    }

    @Override
    public ResponseEntity<FspRequest> replaceFsp(String fspId) {
        return ResponseEntity.ok(fspService.replace(fspId, new FspRequest()));
    }

    // --- Workflow ---

    @Override
    public ResponseEntity<List<WorkflowResponse>> getWorkflow(String fspId) {
        return ResponseEntity.ok(workflowService.getWorkflow(fspId));
    }

    @Override
    public ResponseEntity<WorkflowState> getWorkflowState(String fspId) {
        return ResponseEntity.ok(workflowService.getWorkflowState(fspId));
    }

    @Override
    public ResponseEntity<WorkflowState> submitWorkflowAction(
            String fspId, WorkflowRequest workflowRequest) {
        return ResponseEntity.ok(
                workflowService.submitAction(fspId, workflowRequest));
    }

    // --- Stocking Standards ---

    @Override
    public ResponseEntity<List<StandardRequest>> getStandards(String fspId) {
        return ResponseEntity.ok(standardsService.getByFspId(fspId));
    }

    @Override
    public ResponseEntity<List<StandardRequest>> saveStandards(String fspId, List<StandardRequest> standards) {
        return ResponseEntity.ok(standardsService.saveAll(fspId, standards));
    }

    @Override
    public ResponseEntity<ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeDetail> createStandardRegime(
            String fspId, ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeCreate body) {
        return ResponseEntity.ok(standardRegimeService.createRegime(fspId, body));
    }

    @Override
    public ResponseEntity<ca.bc.gov.nrs.fsp.api.struct.v1.StandardRegimeDetail> copyStandardRegime(
            String fspId, String regimeId, String amendmentNumber) {
        return ResponseEntity.ok(
                standardRegimeService.copyRegime(fspId, amendmentNumber, regimeId));
    }

    @Override
    public ResponseEntity<Void> deleteStandard(String fspId, String standardId) {
        standardsService.delete(standardId);
        return ResponseEntity.noContent().build();
    }

    // --- Attachments ---

    @Override
    public ResponseEntity<List<AttachmentResponse>> getAttachments(String fspId) {
        return ResponseEntity.ok(attachmentsService.getByFspId(fspId));
    }

    @Override
    public ResponseEntity<List<CodeOption>> getAttachmentCategories(String fspId) {
        return ResponseEntity.ok(codeListsService.getAttachmentCategories(fspId));
    }

    @Override
    public ResponseEntity<AttachmentResponse> uploadAttachment(
            String fspId, MultipartFile file, String typeCode, String description)
            throws IOException {
        return ResponseEntity.ok(attachmentsService.upload(fspId, file, typeCode, description));
    }

    @Override
    public ResponseEntity<byte[]> downloadAttachment(String fspId, Long attachmentId) {
        AttachmentBlob blob = attachmentsService.getAttachment(fspId, attachmentId);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + blob.fileName() + "\"")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(blob.content());
    }

    @Override
    public ResponseEntity<Void> deleteAttachment(String fspId, Long attachmentId) {
        attachmentsService.delete(fspId, attachmentId);
        return ResponseEntity.noContent().build();
    }

    // --- Inbox ---

    @Override
    public ResponseEntity<PageableResponse<FspSearchResult>> getInbox(InboxRequest request) {
        return ResponseEntity.ok(inboxService.getInbox(request));
    }

    // --- History ---

    @Override
    public ResponseEntity<List<WorkflowResponse>> getHistory(String fspId) {
        return ResponseEntity.ok(historyService.getHistory(fspId));
    }

    @Override
    public ResponseEntity<ExtensionSummary> getExtensions(String fspId) {
        return ResponseEntity.ok(extensionService.getSummary(fspId));
    }

    @Override
    public ResponseEntity<ExtensionRequestSaved> createExtension(
            String fspId, ExtensionRequestSave body) {
        var result = extensionService.createRequest(fspId, body);
        return ResponseEntity.ok(new ExtensionRequestSaved(result.extensionId()));
    }

    @Override
    public ResponseEntity<Void> uploadExtensionAttachment(
            String fspId, String extensionId, MultipartFile file, String typeCode, String description)
            throws IOException {
        extensionService.uploadAttachment(fspId, extensionId, file, typeCode, description);
        return ResponseEntity.ok().build();
    }

    @Override
    public ResponseEntity<FduList> getFduList(String fspId) {
        return ResponseEntity.ok(fduService.getFdus(fspId));
    }

    @Override
    public ResponseEntity<FduLicencesUpdated> updateFduLicences(
            String fspId, long fduId, FduLicencesUpdate body) {
        return ResponseEntity.ok(fduService.updateLicences(fspId, fduId, body));
    }

    @Override
    public ResponseEntity<LicenceExistsResponse> licenceExists(
            String fspId, String licenceNumber) {
        return ResponseEntity.ok(fduService.licenceExists(licenceNumber));
    }

    @Override
    public ResponseEntity<StandardRegimeDetail> getStandardRegimeDetail(
            String fspId, String regimeId, String amendmentNumber) {
        return ResponseEntity.ok(
                standardRegimeService.getDetail(fspId, amendmentNumber, regimeId));
    }

    @Override
    public ResponseEntity<StandardRegimeDetail> getStandardRegimeDetailByRegime(String regimeId) {
        return ResponseEntity.ok(standardRegimeService.getDetailByRegime(regimeId));
    }

    @Override
    public ResponseEntity<StandardRegimeDetail> updateStandardRegimeOverview(
            String fspId, String regimeId, String amendmentNumber,
            StandardRegimeOverviewUpdate body) {
        return ResponseEntity.ok(
                standardRegimeService.saveOverview(fspId, regimeId, amendmentNumber, body));
    }

    @Override
    public ResponseEntity<StandardRegimeLayerDetail> getStandardRegimeLayerDetail(
            String fspId, String regimeId, String layerCode, String layerId) {
        return ResponseEntity.ok(
                standardRegimeService.getLayerDetail(regimeId, layerCode, layerId));
    }

    @Override
    public ResponseEntity<StandardRegimeLayerDetail> getStandardRegimeLayerDetailByRegime(
            String regimeId, String layerCode, String layerId) {
        return ResponseEntity.ok(
                standardRegimeService.getLayerDetail(regimeId, layerCode, layerId));
    }

    @Override
    public ResponseEntity<StandardRegimeLayerDetail> updateStandardRegimeLayer(
            String fspId, String regimeId, String layerCode, String layerId,
            String amendmentNumber, StandardRegimeLayerUpdate body) {
        return ResponseEntity.ok(
                standardRegimeService.saveLayer(
                        fspId, regimeId, layerCode, layerId, amendmentNumber, body));
    }

    @Override
    public ResponseEntity<StandardRegimeLayerDetail> addStandardRegimeLayerSpecies(
            String fspId, String regimeId, String layerCode, String layerId,
            StandardRegimeLayerSpeciesAdd body) {
        return ResponseEntity.ok(standardRegimeService.addLayerSpecies(
                fspId, regimeId, layerCode, layerId,
                body.getSpeciesCode(), body.getMinHeight(), body.isPreferred()));
    }

    @Override
    public ResponseEntity<StandardRegimeLayerDetail> deleteStandardRegimeLayerSpecies(
            String fspId, String regimeId, String layerCode, String speciesCode,
            String layerId, String preferred, String revisionCount) {
        return ResponseEntity.ok(standardRegimeService.deleteLayerSpecies(
                fspId, regimeId, layerCode, layerId,
                speciesCode, "Y".equalsIgnoreCase(preferred), revisionCount));
    }

    @Override
    public ResponseEntity<StandardRegimeDetail> convertStandardRegimeLayers(
            String fspId, String regimeId, String amendmentNumber) {
        return ResponseEntity.ok(standardRegimeService.convertLayers(
                fspId, amendmentNumber, regimeId));
    }

    @Override
    public ResponseEntity<StandardRegimeDetail> addStandardRegimeBgcZone(
            String fspId, String regimeId, String amendmentNumber,
            StandardRegimeBgcZoneUpsert body) {
        return ResponseEntity.ok(standardRegimeService.saveBgcItem(
                fspId, amendmentNumber, regimeId, null, null, body));
    }

    @Override
    public ResponseEntity<StandardRegimeDetail> deleteStandardRegimeBgcZone(
            String fspId, String regimeId, String siteSeriesId,
            String revisionCount, String amendmentNumber) {
        return ResponseEntity.ok(standardRegimeService.deleteBgcItem(
                fspId, amendmentNumber, regimeId, siteSeriesId, revisionCount));
    }

    @Override
    public ResponseEntity<StandardRegimeDetail> updateStandardRegimeBgcZone(
            String fspId, String regimeId, String siteSeriesId,
            String revisionCount, String amendmentNumber,
            StandardRegimeBgcZoneUpsert body) {
        return ResponseEntity.ok(standardRegimeService.saveBgcItem(
                fspId, amendmentNumber, regimeId, siteSeriesId, revisionCount, body));
    }

    // --- Map View extent ---

    @Override
    public ResponseEntity<FspExtentResponse> getExtent(String fspId, String amendmentNumber) {
        int fsp = Integer.parseInt(fspId);
        int amend = Integer.parseInt(amendmentNumber);
        return ResponseEntity.ok(fspExtentService.getExtent(fsp, amend));
    }

    // --- District Auto-Notification (Admin) ---

    @Override
    public ResponseEntity<List<NotificationDesignate>> getDistrictDesignates(String orgUnitNo) {
        return ResponseEntity.ok(districtNotificationService.getDesignates(orgUnitNo));
    }

    @Override
    public ResponseEntity<Void> addDistrictDesignate(NotificationDesignate body) {
        districtNotificationService.addDesignate(
                body.getOrgUnitNo(),
                body.getDesignateIdir());
        return ResponseEntity.noContent().build();
    }

    @Override
    public ResponseEntity<Void> removeDistrictDesignate(String designateId) {
        districtNotificationService.removeDesignate(designateId);
        return ResponseEntity.noContent().build();
    }

    // --- IDIR directory lookup (nr-user-lookup-api) ---

    @Override
    public ResponseEntity<UserSearchResponse> searchUsers(
            String userId, String firstName, String lastName, int size) {
        return ResponseEntity.ok(userDirectoryService.searchUsers(userId, firstName, lastName, size));
    }
}
