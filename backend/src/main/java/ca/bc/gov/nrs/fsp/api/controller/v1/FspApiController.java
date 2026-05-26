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
    private final WorkflowService workflowService;
    private final StandardsService standardsService;
    private final AttachmentsService attachmentsService;
    private final InboxService inboxService;
    private final HistoryService historyService;
    private final CodeListsService codeListsService;
    private final FspExtentService fspExtentService;

    public FspApiController(FspService fspService, WorkflowService workflowService,
                            StandardsService standardsService, AttachmentsService attachmentsService,
                            InboxService inboxService, HistoryService historyService,
                            CodeListsService codeListsService, FspExtentService fspExtentService) {
        this.fspService = fspService;
        this.workflowService = workflowService;
        this.standardsService = standardsService;
        this.attachmentsService = attachmentsService;
        this.inboxService = inboxService;
        this.historyService = historyService;
        this.codeListsService = codeListsService;
        this.fspExtentService = fspExtentService;
    }

    // --- Code Lists (dropdown options) ---

    @Override
    public ResponseEntity<List<CodeOption>> getOrgUnits() {
        return ResponseEntity.ok(codeListsService.getOrgUnits());
    }

    @Override
    public ResponseEntity<List<CodeOption>> getFspStatusCodes() {
        return ResponseEntity.ok(codeListsService.getFspStatusCodes());
    }

    // --- FSP ---

    @Override
    public ResponseEntity<PageableResponse<FspSearchResult>> searchFsp(FspSearchRequest request) {
        return ResponseEntity.ok(fspService.search(request));
    }

    @Override
    public ResponseEntity<FspRequest> getFspById(String fspId) {
        return ResponseEntity.ok(fspService.getById(fspId));
    }

    @Override
    public ResponseEntity<FspRequest> updateFsp(String fspId, FspRequest fspRequest) {
        return ResponseEntity.ok(fspService.update(fspId, fspRequest));
    }

    // --- Workflow ---

    @Override
    public ResponseEntity<List<WorkflowResponse>> getWorkflow(String fspId) {
        return ResponseEntity.ok(workflowService.getWorkflow(fspId));
    }

    @Override
    public ResponseEntity<Void> submitWorkflowAction(String fspId, WorkflowRequest workflowRequest) {
        workflowService.submitAction(fspId, workflowRequest);
        return ResponseEntity.ok().build();
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
    public ResponseEntity<AttachmentResponse> uploadAttachment(String fspId, MultipartFile file, String typeCode) throws IOException {
        return ResponseEntity.ok(attachmentsService.upload(fspId, file, typeCode));
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

    // --- Map View extent ---

    @Override
    public ResponseEntity<FspExtentResponse> getExtent(String fspId, String amendmentNumber) {
        int fsp = Integer.parseInt(fspId);
        int amend = Integer.parseInt(amendmentNumber);
        return ResponseEntity.ok(fspExtentService.getExtent(fsp, amend));
    }
}
