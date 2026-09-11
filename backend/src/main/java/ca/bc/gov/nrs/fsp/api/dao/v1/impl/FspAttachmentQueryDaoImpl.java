package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.FspAttachmentQueryDao;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class FspAttachmentQueryDaoImpl implements FspAttachmentQueryDao {

  // FSP_ATTACHMENT_TYPE_CODE for the "FSP Legal Document" category —
  // matches AttachmentsService.TYPE_LEGAL_DOCS and the type code
  // fsp_common_validation checks in its APP/INE branch.
  private static final String TYPE_LEGAL_DOCS = "FSP";

  // FSP_ATTACHMENT_TYPE_CODE for the FDU map category — matches
  // AttachmentsService.TYPE_FDU_MAP and FSP_700_WORKFLOW.has_map_attachments.
  private static final String TYPE_FDU_MAP = "MAP";

  // An attachment of the given type linked to this exact fsp_id + amendment
  // via the xref table — the existence check fsp_common_validation runs for
  // FSP-type (V9.00203 FSP_COMMON_VALIDATION.sql:886-893) and
  // FSP_700_WORKFLOW.has_map_attachments runs for MAP-type.
  private static final String ATTACHMENT_OF_TYPE_COUNT_SQL =
      "SELECT COUNT(1) "
          + "  FROM the.fsp_attachment_xref fax "
          + "  JOIN the.fsp_attachment fa "
          + "    ON fa.fsp_attachment_id = fax.fsp_attachment_id "
          + " WHERE fax.fsp_id = ? "
          + "   AND fax.fsp_amendment_number = ? "
          + "   AND fa.fsp_attachment_type_code = ?";

  // FDU header rows for this exact fsp/amendment. FOREST_DEVELOPMENT_UNIT is
  // keyed on both, and fsp_create_amendment copies rows forward, so this needs
  // no join or fallback to the original amendment.
  private static final String FDU_COUNT_SQL =
      "SELECT COUNT(1) FROM the.forest_development_unit "
          + " WHERE fsp_id = ? AND fsp_amendment_number = ?";

  private final JdbcTemplate jdbcTemplate;

  public FspAttachmentQueryDaoImpl(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  @Override
  public boolean hasLegalDocument(long fspId, long amendmentNumber) {
    return hasAttachmentOfType(fspId, amendmentNumber, TYPE_LEGAL_DOCS);
  }

  @Override
  public boolean hasMapAttachment(long fspId, long amendmentNumber) {
    return hasAttachmentOfType(fspId, amendmentNumber, TYPE_FDU_MAP);
  }

  private boolean hasAttachmentOfType(long fspId, long amendmentNumber, String typeCode) {
    Integer count = jdbcTemplate.queryForObject(
        ATTACHMENT_OF_TYPE_COUNT_SQL, Integer.class,
        fspId, amendmentNumber, typeCode);
    return count != null && count > 0;
  }

  @Override
  public boolean hasFdu(long fspId, long amendmentNumber) {
    Integer count = jdbcTemplate.queryForObject(
        FDU_COUNT_SQL, Integer.class, fspId, amendmentNumber);
    return count != null && count > 0;
  }
}
