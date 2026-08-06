package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp302ExtensionRequestDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp303ExtensionSummaryDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FspExtensionQueryDao;
import ca.bc.gov.nrs.fsp.api.security.FspAccessGuard;
import ca.bc.gov.nrs.fsp.api.struct.v1.ExtensionAttachmentResponse;
import ca.bc.gov.nrs.fsp.api.struct.v1.ExtensionRequestSave;
import ca.bc.gov.nrs.fsp.api.struct.v1.ExtensionSummary;
import ca.bc.gov.nrs.fsp.api.util.AttachmentConstraints;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

/**
 * Read wrapper for FSP_303_EXTENSION_SUMMARY.GET_LIST. Audit-user
 * context (client, role, userid) is pulled from the current JWT via
 * {@link RequestUtil} so this service shares the exact same
 * FAM-cognito → legacy-proc translation as FspService.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ExtensionService {

  private static final String DEFAULT_CONSOLIDATED_IND = "N";

  /**
   * FSP_ATTACHMENT_TYPE_CODE {@code EXT} — "Extension Request", the
   * purpose-built category for the letter accompanying an extension
   * request (its sibling {@code EXDDMD} carries the decision). It is also
   * the only code {@code FspAccessGuard}'s extension carve-out accepts
   * from a Submitter, so the two must stay in step.
   */
  private static final String EXTENSION_REQUEST_TYPE_CODE = "EXT";
  private static final String EXTENSION_SUPPORTING_DOC_DESCRIPTION =
      "Extension request supporting document";

  private final Fsp303ExtensionSummaryDao dao;
  private final Fsp302ExtensionRequestDao requestDao;
  private final FspExtensionQueryDao extensionQueryDao;
  private final FspAccessGuard accessGuard;
  private final VirusScanner virusScanner;

  /**
   * Attachments linked to a single extension (request letter, EXDDMD
   * decision letter, …). Read-only lookup for the Extension Summary
   * dialog; the files download through the shared attachment endpoint.
   */
  public List<ExtensionAttachmentResponse> listAttachments(String fspId, String extensionId) {
    return extensionQueryDao.findExtensionAttachments(Long.parseLong(extensionId)).stream()
        .map(a -> new ExtensionAttachmentResponse(
            a.attachmentId(), a.attachmentName(), a.typeCode()))
        .toList();
  }

  public ExtensionSummary getSummary(String fspId) {
    Fsp303ExtensionSummaryDao.Result r = dao.getList(
        fspId,
        RequestUtil.getCurrentClientNumber(),
        RequestUtil.getCurrentLegacyRoles(),
        RequestUtil.getCurrentIdir());
    List<ExtensionSummary.Extension> extensions = r.extensions().stream()
        .map(e -> new ExtensionSummary.Extension(
            e.extensionId(),
            e.extensionNumber(),
            e.statusCode(),
            e.statusDescription(),
            e.planTermYears(),
            e.planTermMonths(),
            e.planStartDate(),
            e.planEndDate(),
            e.submissionDate(),
            e.decisionDate(),
            e.approvalDate(),
            e.rejectDate(),
            e.fspAmendmentNumber(),
            e.statusComment()))
        .toList();
    return new ExtensionSummary(
        r.fspId(),
        r.fspPlanName(),
        r.originalEffectiveDate(),
        r.originalExpiryDate(),
        r.currentPlanTermYears(),
        r.currentPlanTermMonths(),
        r.currentExpiryDate(),
        extensions);
  }

  /**
   * Create a new extension request via FSP_302_EXTENSION_REQUEST.SAVE.
   * Audit-user context is pulled from the JWT — userId is the
   * directory-prefixed form (IDIR\name / BCEID\name) so the audit
   * columns match the legacy convention.
   *
   * @return the proc-assigned extension id (and any error string).
   */
  @Transactional
  public Fsp302ExtensionRequestDao.SaveResult createRequest(
      String fspId, ExtensionRequestSave body) {
    // A plan may only have one open extension request at a time — block a
    // new one while an earlier request is still Submitted (awaiting a DDM
    // decision). Mirrors the UI (hidden Extend button) and the XML guard.
    if (extensionQueryDao.hasOpenExtension(Long.parseLong(fspId))) {
      throw new IllegalArgumentException(
          "This FSP already has an open extension request awaiting a decision. "
              + "Resolve it before submitting another extension.");
    }
    Fsp302ExtensionRequestDao.SaveRequest req = new Fsp302ExtensionRequestDao.SaveRequest(
        fspId,
        null,                                            // extensionId = null → create
        body.getPlanTermYears(),
        body.getPlanTermMonths(),
        body.getFspExpiryDate(),
        body.getStatusComment(),
        RequestUtil.getCurrentClientNumber(),
        RequestUtil.getCurrentLegacyRoles(),
        RequestUtil.getCurrentAuditUserId(),
        body.getRevisionCount());
    Fsp302ExtensionRequestDao.SaveResult result = requestDao.save(req);
    log.info("FSP_302 SAVE — fspId={} → new extensionId={}", fspId, result.extensionId());
    return result;
  }

  /**
   * Create an extension request and persist its supporting documents in a
   * single transaction.
   *
   * <p>Replaces the client-orchestrated sequence the extension dialog used
   * to run (POST /extensions, commit, then a POST /attachments per file).
   * That ordering committed the request before any upload was attempted,
   * so a rejected or interrupted upload left the extension on record with
   * its letter gone — and because a Submitter can't upload to an Approved /
   * In-Effect plan from anywhere else, there was no way to recover.
   *
   * <p>Ordering matters and is deliberate: the request is created first so
   * the extension row exists, then the attachments are written. The
   * supporting-document carve-out in
   * {@code FspAccessGuard.assertAttachmentEditable} looks for an extension
   * in {@code SUB} on this FSP — inside this transaction that lookup sees
   * our own uncommitted insert, so the carve-out applies without being
   * loosened. Any failure on any file throws, and the whole unit
   * (extension + every attachment) rolls back.
   *
   * @param files supporting documents; may be empty.
   */
  @Transactional
  public Fsp302ExtensionRequestDao.SaveResult createRequestWithAttachments(
      String fspId, ExtensionRequestSave body, List<MultipartFile> files) throws IOException {
    Fsp302ExtensionRequestDao.SaveResult result = createRequest(fspId, body);

    if (files == null || files.isEmpty()) {
      return result;
    }
    for (MultipartFile file : files) {
      if (file == null || file.isEmpty()) {
        continue;
      }
      // Routed through the EXTENSION-linked upload, not the FSP-level one.
      // Both ultimately call fsp_common_db.fsp_attachment_create, but the
      // overloads differ: passing (fsp_id, amendment) writes
      // fsp_attachment_xref while passing extension_id writes
      // fsp_extension_xref. Only the latter ties the file to the extension,
      // and it is what the Extension Summary dialog reads — going through
      // AttachmentsService stored the letter but left it invisible there.
      // Same transaction, so a throw here unwinds the extension too.
      uploadAttachment(
          fspId, result.extensionId(), file,
          EXTENSION_REQUEST_TYPE_CODE, EXTENSION_SUPPORTING_DOC_DESCRIPTION);
    }
    log.info("FSP_302 SAVE — fspId={} extensionId={} committed with {} attachment(s)",
        fspId, result.extensionId(), files.size());
    return result;
  }

  /**
   * Upload an attachment linked to an extension (not the FSP) via
   * FSP_302_EXTENSION_REQUEST.CREATE_ATTACHMENT + SAVE_ATTACHMENT_CONTENT.
   * Used for the extension decision letter (typeCode {@code EXDDMD}),
   * which {@code FSP_700_WORKFLOW.validate_ext_approve_reject} requires
   * to be linked to the extension via {@code fsp_extension_xref} before
   * an approve/reject will succeed.
   *
   * @param fspId       the parent FSP — used only for the ownership fence.
   * @param extensionId the extension the attachment is linked to.
   */
  @Transactional
  public void uploadAttachment(
      String fspId, String extensionId, MultipartFile file,
      String typeCode, String description) throws IOException {
    // Ownership fence (same rule the FSP attachment upload uses) — the
    // proc doesn't thread the caller's client number, so gate here.
    // typeCode MUST be threaded: an extension decision is taken while the
    // plan is Approved / In-Effect, which is outside a Decision Maker's
    // normal B2 window, so the EXDDMD carve-out is what makes the
    // decision letter uploadable at all.
    accessGuard.assertAttachmentEditable(fspId, null, typeCode);
    // Type / filename-length / size fence. This path had none — only the
    // FSP-level upload did — so an over-long name reached the insert and
    // died as an opaque ORA-12899. Same rules, one shared definition.
    AttachmentConstraints.validate(file.getOriginalFilename(), file.getSize());
    // Read the upload into heap ONCE and reuse it for the scan and the
    // BLOB write. getBytes() allocates a fresh full-size array per call,
    // so calling it twice held 2x the file in heap simultaneously.
    byte[] content = file.getBytes();
    // Virus scan before storing — throws (→ 422) on rejection; no-op
    // when fsp.clamav.enabled=false.
    virusScanner.scanOrThrow(content, file.getOriginalFilename());
    String userId = RequestUtil.getCurrentAuditUserId();
    Fsp302ExtensionRequestDao.CreateAttachmentResult created = requestDao.createAttachment(
        extensionId,
        typeCode,
        file.getOriginalFilename(),
        file.getSize(),
        description == null ? "" : description.trim(),
        DEFAULT_CONSOLIDATED_IND,
        userId);
    requestDao.saveAttachmentContent(created.createdAttachmentId(), content);
    log.info("FSP_302 CREATE_ATTACHMENT — extensionId={} type={} → attachmentId={}",
        extensionId, typeCode, created.createdAttachmentId());
  }
}
