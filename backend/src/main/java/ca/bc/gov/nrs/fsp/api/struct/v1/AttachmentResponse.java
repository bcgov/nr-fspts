package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Mirrors a row of any FSP_400_ATTACHMENTS.GET cursor (legalDocs, supportingDocs,
 * etc.). All fields are VARCHAR in the legacy proc; numeric-looking IDs are kept
 * as String to avoid lossy conversion at this layer.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AttachmentResponse {

  private String fspAttachmentId;
  private String fspAmendmentNumber;
  private String attachmentName;
  private String attachmentDescription;
  private String attachmentSize;
  private String consolidatedInd;
  // Which of the nine FSP_400_ATTACHMENTS cursors the row came from
  // ("FSP Legal Documents", "DDM Decision", etc.). The proc returns
  // them as separate cursors keyed off the type code passed to
  // get_fsp_attachments_by_type — we stamp the human label onto each
  // row so a single flat list still preserves the category.
  private String category;
}
