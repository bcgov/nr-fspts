package ca.bc.gov.nrs.fsp.api.service.v1;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp400AttachmentsDao;
import ca.bc.gov.nrs.fsp.api.struct.v1.AttachmentBlob;
import ca.bc.gov.nrs.fsp.api.struct.v1.AttachmentResponse;
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

  private final Fsp400AttachmentsDao attachmentsDao;
  private final JdbcTemplate jdbcTemplate;

  public AttachmentsService(Fsp400AttachmentsDao attachmentsDao, JdbcTemplate jdbcTemplate) {
    this.attachmentsDao = attachmentsDao;
    this.jdbcTemplate = jdbcTemplate;
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
    // Category labels mirror the section headings on the legacy
    // attachments page (FSP_400). Order preserved so the flat list
    // groups naturally when the front-end renders by category.
    List<AttachmentResponse> all = new ArrayList<>();
    appendAll(all, get.legalDocs(),       "FSP Legal Documents");
    appendAll(all, get.amendDesc(),       "Amendment Description");
    appendAll(all, get.stockStandards(),  "Stocking Standards");
    appendAll(all, get.fduMap(),          "FDU Map");
    appendAll(all, get.identAreas1961(),  "Identified Areas – FRPA s.196(1)");
    appendAll(all, get.identAreas1962(),  "Identified Areas – FRPA s.196(2)");
    appendAll(all, get.declaredAreas(),   "Declared Areas – FPPR s.14(4)");
    appendAll(all, get.supportingDocs(),  "Supporting Documents");
    appendAll(all, get.ddmDecision(),     "DDM Decision");
    return all;
  }

  public AttachmentBlob getAttachment(String fspId, Long attachmentId) {
    Fsp400AttachmentsDao.AttachBlob blob = attachmentsDao.getAttachBlob(attachmentId);
    return new AttachmentBlob(blob.fileName(), blob.content());
  }

  @Transactional
  public AttachmentResponse upload(
      String fspId, MultipartFile file, String typeCode, String description)
      throws IOException {
    // Resolve the FSP's current latest amendment number — the old
    // hardcoded "1" tripped FAX_FSP_FK whenever the FSP's amendments
    // didn't include 1 (e.g. original-only FSPs sitting at amendment 0).
    String amendmentNumber = findLatestAmendmentNumber(fspId);
    // Directory-prefixed audit user (IDIR\name / BCEID\name) so the
    // attachment row matches the legacy audit convention. Truncated
    // to 30 chars inside the helper so the prefix doesn't blow the
    // VARCHAR2(30) audit columns.
    String userId = RequestUtil.getCurrentAuditUserId();
    Fsp400AttachmentsDao.CreateAttachmentResult created = attachmentsDao.createAttachment(
        Long.valueOf(fspId),
        amendmentNumber,
        typeCode,
        file.getOriginalFilename(),
        file.getSize(),
        description == null ? "" : description.trim(),
        DEFAULT_CONSOLIDATED_IND,
        userId);
    attachmentsDao.saveAttachmentContent(created.createdAttachmentId(), file.getBytes());
    return AttachmentResponse.builder()
        .fspAttachmentId(String.valueOf(created.createdAttachmentId()))
        .fspAmendmentNumber(amendmentNumber)
        .attachmentName(file.getOriginalFilename())
        .attachmentSize(String.valueOf(file.getSize()))
        .consolidatedInd(DEFAULT_CONSOLIDATED_IND)
        .build();
  }

  @Transactional
  public void delete(String fspId, Long attachmentId) {
    attachmentsDao.removeAttachment(
        Long.valueOf(fspId), findLatestAmendmentNumber(fspId), attachmentId);
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
      String category) {
    for (Fsp400AttachmentsDao.AttachmentRow row : rows) {
      sink.add(AttachmentResponse.builder()
          .fspAttachmentId(row.fspAttachmentId())
          .fspAmendmentNumber(row.fspAmendmentNumber())
          .attachmentName(row.attachmentName())
          .attachmentDescription(row.attachmentDescription())
          .attachmentSize(row.attachmentSize())
          .consolidatedInd(row.consolidatedInd())
          .category(category)
          .build());
    }
  }
}
