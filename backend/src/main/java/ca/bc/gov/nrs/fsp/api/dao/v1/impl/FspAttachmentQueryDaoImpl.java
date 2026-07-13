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

  // Same existence check fsp_common_validation runs (V9.00203
  // FSP_COMMON_VALIDATION.sql:886-893): an FSP-type attachment linked to
  // this exact fsp_id + amendment via the xref table.
  private static final String LEGAL_DOC_COUNT_SQL =
      "SELECT COUNT(1) "
          + "  FROM the.fsp_attachment_xref fax "
          + "  JOIN the.fsp_attachment fa "
          + "    ON fa.fsp_attachment_id = fax.fsp_attachment_id "
          + " WHERE fax.fsp_id = ? "
          + "   AND fax.fsp_amendment_number = ? "
          + "   AND fa.fsp_attachment_type_code = ?";

  private final JdbcTemplate jdbcTemplate;

  public FspAttachmentQueryDaoImpl(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  @Override
  public boolean hasLegalDocument(long fspId, long amendmentNumber) {
    Integer count = jdbcTemplate.queryForObject(
        LEGAL_DOC_COUNT_SQL, Integer.class,
        fspId, amendmentNumber, TYPE_LEGAL_DOCS);
    return count != null && count > 0;
  }
}
