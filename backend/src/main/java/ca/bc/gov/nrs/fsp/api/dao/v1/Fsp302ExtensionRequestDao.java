package ca.bc.gov.nrs.fsp.api.dao.v1;

/**
 * Wraps {@code FSP_302_EXTENSION_REQUEST.SAVE}. Two flows:
 *
 * <ul>
 *   <li>{@code extensionId == null} → proc routes to
 *       {@code fsp_common_db.fsp_create_extension}, assigns a new
 *       {@code extension_id} from the sequence, and writes the row.
 *       This is the "Extend FSP" dialog's path.</li>
 *   <li>{@code extensionId != null} → proc routes to
 *       {@code fsp_common_db.fsp_update_extension}. Only callers with
 *       {@code FSP_ADMINISTRATOR} can take this path; everyone else's
 *       update is silently a no-op.</li>
 * </ul>
 *
 * <p>Authorization (role + client number) is enforced by the proc.
 */
public interface Fsp302ExtensionRequestDao {

  String PACKAGE_NAME = "FSP_302_EXTENSION_REQUEST";

  /**
   * @param extensionId pass {@code null} to create a new extension; the
   *     proc-assigned id comes back in {@link SaveResult#extensionId}.
   * @return the (possibly newly-assigned) extension id + the proc's
   *     accumulated error message (blank on success).
   */
  SaveResult save(SaveRequest req);

  record SaveRequest(
      String fspId,
      String extensionId,
      String newPlanTermYears,
      String newPlanTermMonths,
      String newFspExpiryDate,
      String statusComment,
      String userClientNumber,
      String userRole,
      String userId,
      String revisionCount) {}

  record SaveResult(String extensionId, String revisionCount, String errorMessage) {}

  /**
   * Creates an attachment linked to the extension via
   * {@code FSP_302_EXTENSION_REQUEST.CREATE_ATTACHMENT} (which writes
   * {@code fsp_extension_xref}, keyed on {@code extension_id}). This is
   * the linkage {@code FSP_700_WORKFLOW.validate_ext_approve_reject}
   * checks for the required EXDDMD decision letter — the FSP-level
   * {@code FSP_400_ATTACHMENTS.CREATE_ATTACHMENT} writes a different xref
   * table and does NOT satisfy that check.
   */
  CreateAttachmentResult createAttachment(
      String extensionId, String attachmentType, String filename,
      Long fileSize, String description, String consolidatedInd, String userId);

  /** Stores the BLOB content for a previously-created attachment. */
  String saveAttachmentContent(Long attachmentId, byte[] content);

  record CreateAttachmentResult(Long createdAttachmentId, String errorMessage) {}
}
