package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp400AttachmentsDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FspAttachmentQueryDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FspCodeListsDao;
import ca.bc.gov.nrs.fsp.api.exception.ConflictFoundException;
import ca.bc.gov.nrs.fsp.api.security.FspAccessGuard;
import ca.bc.gov.nrs.fsp.api.struct.v1.AttachmentBlob;
import ca.bc.gov.nrs.fsp.api.struct.v1.AttachmentResponse;
import ca.bc.gov.nrs.fsp.api.util.AttachmentConstraints;
import ca.bc.gov.nrs.fsp.api.util.RequestUtil;
import lombok.extern.slf4j.Slf4j;
// RequiredArgsConstructor dropped — explicit constructor below so
// JdbcTemplate (added for the amendment-lookup) injects cleanly.
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Wraps the FSP_400_ATTACHMENTS package. The legacy GET proc returns 9 distinct
 * attachment-category cursors; this list endpoint flattens them into a single
 * list as the simplest preservation of "all attachments for an FSP".
 */
@Service
@Slf4j
public class AttachmentsService {

  private static final String ALL_ATTACHES_IND = "Y";
  private static final String DEFAULT_CONSOLIDATED_IND = "N";
  static final String LEGAL_DOC_EXISTS_MESSAGE =
      "This version already has an FSP legal document. Delete it before adding another.";

  // Bucket → FSP_ATTACHMENT_TYPE_CODE.fsp_attachment_type_code. Matches
  // the per-bucket filter inside FSP_400_ATTACHMENTS.GET (see
  // R__06397_FSP_400_ATTACHMENTS.sql lines 77-126). Drives the lookup
  // into the cached type-code description map so the rendered category
  // label tracks whatever the DBA has in FSP_ATTACHMENT_TYPE_CODE.
  private static final String TYPE_LEGAL_DOCS       = "FSP";
  private static final String TYPE_AMEND_DESC       = "AMDS";
  private static final String TYPE_STOCK_STANDARDS  = "SS";
  private static final String TYPE_FDU_MAP          = "MAP";
  private static final String TYPE_IDENT_AREAS_1961 = "FRPA196(1)";
  private static final String TYPE_IDENT_AREAS_1962 = "FRPA196(2)";
  private static final String TYPE_DECLARED_AREAS   = "FPPR14(4)";
  private static final String TYPE_SUPPORTING_DOCS  = "OTHR";
  private static final String TYPE_DDM_DECISION     = "DDMD";

  private final Fsp400AttachmentsDao attachmentsDao;
  private final FspAttachmentQueryDao attachmentQueryDao;
  private final FspCodeListsDao codeListsDao;
  private final JdbcTemplate jdbcTemplate;
  private final FspAccessGuard accessGuard;
  private final VirusScanner virusScanner;

  public AttachmentsService(
      Fsp400AttachmentsDao attachmentsDao,
      FspAttachmentQueryDao attachmentQueryDao,
      FspCodeListsDao codeListsDao,
      JdbcTemplate jdbcTemplate,
      FspAccessGuard accessGuard,
      VirusScanner virusScanner) {
    this.attachmentsDao = attachmentsDao;
    this.attachmentQueryDao = attachmentQueryDao;
    this.codeListsDao = codeListsDao;
    this.jdbcTemplate = jdbcTemplate;
    this.accessGuard = accessGuard;
    this.virusScanner = virusScanner;
  }

  public List<AttachmentResponse> getByFspId(String fspId) {
    // Bind for fsp_tombstone.get's "find latest accessible amendment"
    // branch the same way FspService does:
    //   - FSP id flows in via P_NEW_FSP_ID; P_FSP_ID stays blank so the
    //     OR check (p_fsp_id <> p_new_fsp_id) trips to UNKNOWN, then
    //     the IS NULL on p_new_fsp_amendment_number takes us into the
    //     latest-amendment branch.
    //   - Send blank for both amendment-number slots so the proc
    //     resolves to the most recent amendment the user can access.
    //   - Audit-user context (client + role) must come from the JWT,
    //     not be hard-coded empty, or user_may_access returns 'N' and
    //     the cursor lists come back empty.
    Fsp400AttachmentsDao.GetResult get = attachmentsDao.get(
        "",                                       // p_fsp_id
        fspId,                                    // p_new_fsp_id
        "",                                       // p_fsp_amendment_number
        "",                                       // p_new_fsp_amendment_number
        RequestUtil.getCurrentClientNumber(),     // p_user_client_number
        RequestUtil.getCurrentLegacyRoles(),      // p_user_role
        ALL_ATTACHES_IND);
    // Category labels come from the cached typeCode → description map
    // (FSP_ATTACHMENT_TYPE_CODE) — DB is the source of truth so a DBA
    // rename in that table is reflected on the Attachments tab without
    // a code change. Bucket order is preserved so the flat list groups
    // naturally when the front-end renders by category.
    Map<String, String> descriptions = codeListsDao.getFspAttachmentTypeCodeMap();
    List<AttachmentResponse> all = new ArrayList<>();
    appendAll(all, get.legalDocs(), TYPE_LEGAL_DOCS, descriptions);
    appendAll(all, get.amendDesc(), TYPE_AMEND_DESC, descriptions);
    appendAll(all, get.stockStandards(), TYPE_STOCK_STANDARDS, descriptions);
    appendAll(all, get.fduMap(), TYPE_FDU_MAP, descriptions);
    appendAll(all, get.identAreas1961(), TYPE_IDENT_AREAS_1961, descriptions);
    appendAll(all, get.identAreas1962(), TYPE_IDENT_AREAS_1962, descriptions);
    appendAll(all, get.declaredAreas(), TYPE_DECLARED_AREAS, descriptions);
    appendAll(all, get.supportingDocs(), TYPE_SUPPORTING_DOCS, descriptions);
    appendAll(all, get.ddmDecision(), TYPE_DDM_DECISION, descriptions);
    setDeleteTargets(fspId, all);
    return all;
  }

  /**
   * Stamps each row with the version a delete by this user would act on, using
   * the same rules {@link #delete} enforces: the latest version when the file
   * is linked to it and the user may edit it there; otherwise the row's own
   * version, for an Administrator only.
   */
  private void setDeleteTargets(String fspId, List<AttachmentResponse> rows) {
    if (rows.isEmpty() || !accessGuard.canEditAttachments(fspId)) {
      return;
    }
    String latest = findLatestAmendmentNumber(fspId);
    Set<Long> linkedToLatest = attachmentQueryDao.findLinkedAttachmentIds(
        Long.parseLong(fspId), Long.parseLong(latest));
    boolean priorVersionsAllowed = accessGuard.canDeleteFromPriorVersions();
    for (AttachmentResponse row : rows) {
      boolean onLatest = linkedToLatest.contains(Long.valueOf(row.getFspAttachmentId()));
      row.setLinkedToLatest(onLatest);
      if (onLatest) {
        row.setDeleteAmendmentNumber(latest);
      } else if (priorVersionsAllowed) {
        row.setDeleteAmendmentNumber(row.getFspAmendmentNumber());
      }
    }
  }

  /**
   * @return the {@code description} column for the given type code, or
   *     the bare code itself when the lookup is missing or blank
   *     (defensive — keeps the cell from rendering empty if a DBA
   *     deletes a row that still has live attachments).
   */
  private static String categoryLabel(Map<String, String> descriptions, String typeCode) {
    String desc = descriptions.get(typeCode);
    return desc == null || desc.isBlank() ? typeCode : desc;
  }

  public AttachmentBlob getAttachment(String fspId, Long attachmentId) {
    Fsp400AttachmentsDao.AttachBlob blob = attachmentsDao.getAttachBlob(attachmentId);
    return new AttachmentBlob(blob.fileName(), blob.content());
  }

  @Transactional
  public AttachmentResponse upload(
      String fspId, MultipartFile file, String typeCode, String description)
      throws IOException {
    return upload(fspId, file, typeCode, description, null);
  }

  /**
   * Legacy FSP400 consolidated-indicator rule. Only the FSP Legal Document
   * carries the flag: on the original plan (amendment 0) it is always
   * consolidated (legacy posted a hidden {@code Y}); on an amendment the
   * user chooses via the "Consolidated" checkbox. Every other category is
   * stored as {@code N}.
   */
  static String resolveConsolidatedInd(
      String typeCode, String amendmentNumber, Boolean consolidated) {
    if (!TYPE_LEGAL_DOCS.equals(typeCode)) return DEFAULT_CONSOLIDATED_IND;
    if ("0".equals(amendmentNumber == null ? null : amendmentNumber.trim())) return "Y";
    return Boolean.TRUE.equals(consolidated) ? "Y" : DEFAULT_CONSOLIDATED_IND;
  }

  @Transactional
  public AttachmentResponse upload(
      String fspId, MultipartFile file, String typeCode, String description,
      Boolean consolidated)
      throws IOException {
    // Ownership fence: the attachment proc doesn't thread the caller's
    // client number, so without this a submitter could attach to any
    // org's FSP. Resolves the latest amendment internally. Attachments use
    // the B2 rule (Admin any status; Submitter Draft; DM on SUB/OHS;
    // Reviewer on SUB) — see FspAccessGuard.assertAttachmentEditable.
    // typeCode is threaded so the guard can apply the extension
    // supporting-document carve-out (OTHR + open extension on an APP/INE
    // plan). Without it a Submitter's extension letter is refused after
    // the extension request has already been created.
    accessGuard.assertAttachmentEditable(fspId, null, typeCode);
    // Type / filename-length / size fence. This path previously had NO
    // filename validation at all — the browser was the only guard, so any
    // non-SPA client (or any name the SPA's character count under-measured)
    // reached the insert and died with ORA-12899 as an opaque 500. The
    // extension-request dialog uploads through here, which is how a
    // supporting letter could vanish after the extension was already
    // created. See AttachmentConstraints on why this counts bytes.
    AttachmentConstraints.validate(file.getOriginalFilename(), file.getSize());
    // Resolve the FSP's current latest amendment number — the old
    // hardcoded "1" tripped FAX_FSP_FK whenever the FSP's amendments
    // didn't include 1 (e.g. original-only FSPs sitting at amendment 0).
    String amendmentNumber = findLatestAmendmentNumber(fspId);
    // Legacy FSP400 parity: one FSP Legal Document per version. The legacy
    // page disabled the legal-doc upload row once a legal document was
    // linked (Fsp400AttachmentsFieldManager.hasLegalAttachment); the user
    // had to delete it before adding a replacement. Checked before reading /
    // scanning the file so a refused upload costs nothing.
    if (TYPE_LEGAL_DOCS.equals(typeCode)
        && attachmentQueryDao.hasLegalDocument(
            Long.parseLong(fspId), Long.parseLong(amendmentNumber))) {
      throw new ConflictFoundException(LEGAL_DOC_EXISTS_MESSAGE);
    }
    // Read the upload into heap ONCE and reuse it for both the scan and the
    // BLOB write. MultipartFile.getBytes() allocates a fresh full-size array
    // on every call, so calling it twice held 2x the file in heap at once —
    // a reliable OutOfMemoryError under the configured 100MB max-file-size.
    byte[] content = file.getBytes();
    // Virus scan the raw bytes before storing — throws
    // VirusDetectedException (→ 422) on rejection. No-op when
    // fsp.clamav.enabled=false.
    virusScanner.scanOrThrow(content, file.getOriginalFilename());
    // Directory-prefixed audit user (IDIR\name / BCEID\name) so the
    // attachment row matches the legacy audit convention. Truncated
    // to 30 chars inside the helper so the prefix doesn't blow the
    // VARCHAR2(30) audit columns.
    String userId = RequestUtil.getCurrentAuditUserId();
    String consolidatedInd = resolveConsolidatedInd(typeCode, amendmentNumber, consolidated);
    Fsp400AttachmentsDao.CreateAttachmentResult created = attachmentsDao.createAttachment(
        Long.valueOf(fspId),
        amendmentNumber,
        typeCode,
        file.getOriginalFilename(),
        file.getSize(),
        description == null ? "" : description.trim(),
        consolidatedInd,
        userId);
    attachmentsDao.saveAttachmentContent(created.createdAttachmentId(), content);
    return AttachmentResponse.builder()
        .fspAttachmentId(String.valueOf(created.createdAttachmentId()))
        .fspAmendmentNumber(amendmentNumber)
        .attachmentName(file.getOriginalFilename())
        .attachmentSize(String.valueOf(file.getSize()))
        .consolidatedInd(consolidatedInd)
        .build();
  }

  /**
   * Removes an attachment's link to one version, and the file itself once no
   * version links to it.
   *
   * @param amendmentNumber the version to remove it from; blank means latest.
   *     Any other version is Administrator only.
   * @throws IllegalArgumentException if the file isn't linked to that version.
   *     The proc reports success when it removes nothing, which used to show
   *     users "deleted" while the attachment stayed in place.
   */
  @Transactional
  public void delete(String fspId, Long attachmentId, String amendmentNumber) {
    long latest = Long.parseLong(findLatestAmendmentNumber(fspId));
    long target = amendmentNumber == null || amendmentNumber.isBlank()
        ? latest
        : parseAmendmentNumber(amendmentNumber);
    if (target == latest) {
      accessGuard.assertAttachmentEditable(fspId, null);
    } else {
      accessGuard.assertPriorVersionAttachmentDeletable(fspId, String.valueOf(target));
    }
    long fsp = Long.parseLong(fspId);
    if (!attachmentQueryDao.findLinkedAttachmentIds(fsp, target).contains(attachmentId)) {
      throw new IllegalArgumentException(
          "This attachment isn't on that version of the FSP, so it wasn't deleted. "
              + "Refresh the page and try again.");
    }
    attachmentsDao.removeAttachment(fsp, String.valueOf(target), attachmentId);
  }

  private static long parseAmendmentNumber(String amendmentNumber) {
    try {
      return Long.parseLong(amendmentNumber.trim());
    } catch (NumberFormatException e) {
      throw new IllegalArgumentException("The FSP version must be a number.", e);
    }
  }

  /**
   * Resolves the highest {@code fsp_amendment_number} that exists on
   * {@code forest_stewardship_plan} for the given FSP. Used by the
   * upload + delete paths so writes target a real FK-valid amendment
   * row instead of a hardcoded guess.
   */
  private String findLatestAmendmentNumber(String fspId) {
    try {
      Long max = jdbcTemplate.queryForObject(
          "SELECT MAX(fsp_amendment_number) "
              + "  FROM the.forest_stewardship_plan "
              + " WHERE fsp_id = ?",
          Long.class, Long.parseLong(fspId));
      if (max == null) {
        throw new IllegalArgumentException(
            "FSP " + fspId + " has no amendments — cannot determine upload target");
      }
      return max.toString();
    } catch (EmptyResultDataAccessException e) {
      throw new IllegalArgumentException("FSP " + fspId + " not found", e);
    } catch (NumberFormatException e) {
      throw new IllegalArgumentException("FSP id must be numeric: " + fspId, e);
    }
  }

  private static void appendAll(
      List<AttachmentResponse> sink,
      List<Fsp400AttachmentsDao.AttachmentRow> rows,
      String categoryCode,
      Map<String, String> descriptions) {
    String category = categoryLabel(descriptions, categoryCode);
    for (Fsp400AttachmentsDao.AttachmentRow row : rows) {
      sink.add(AttachmentResponse.builder()
          .fspAttachmentId(row.fspAttachmentId())
          .fspAmendmentNumber(row.fspAmendmentNumber())
          .attachmentName(row.attachmentName())
          .attachmentDescription(row.attachmentDescription())
          .attachmentSize(row.attachmentSize())
          .consolidatedInd(row.consolidatedInd())
          .category(category)
          .categoryCode(categoryCode)
          .build());
    }
  }
}
