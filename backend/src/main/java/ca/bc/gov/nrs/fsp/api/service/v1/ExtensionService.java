package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp302ExtensionRequestDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp303ExtensionSummaryDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FspExtensionQueryDao;
import ca.bc.gov.nrs.fsp.api.security.FspAccessGuard;
import ca.bc.gov.nrs.fsp.api.struct.v1.ExtensionRequestSave;
import ca.bc.gov.nrs.fsp.api.struct.v1.ExtensionSummary;
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

  private final Fsp303ExtensionSummaryDao dao;
  private final Fsp302ExtensionRequestDao requestDao;
  private final FspExtensionQueryDao extensionQueryDao;
  private final FspAccessGuard accessGuard;
  private final VirusScanner virusScanner;

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
    accessGuard.assertAttachmentEditable(fspId, null);
    // Virus scan before storing — throws (→ 422) on rejection; no-op
    // when fsp.clamav.enabled=false.
    virusScanner.scanOrThrow(file.getBytes(), file.getOriginalFilename());
    String userId = RequestUtil.getCurrentAuditUserId();
    Fsp302ExtensionRequestDao.CreateAttachmentResult created = requestDao.createAttachment(
        extensionId,
        typeCode,
        file.getOriginalFilename(),
        file.getSize(),
        description == null ? "" : description.trim(),
        DEFAULT_CONSOLIDATED_IND,
        userId);
    requestDao.saveAttachmentContent(created.createdAttachmentId(), file.getBytes());
    log.info("FSP_302 CREATE_ATTACHMENT — extensionId={} type={} → attachmentId={}",
        extensionId, typeCode, created.createdAttachmentId());
  }
}
