package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.FspExtensionQueryDao;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class FspExtensionQueryDaoImpl implements FspExtensionQueryDao {

  // FSP_STAT_SUB — a submitted extension is an open request awaiting a
  // DDM decision (see FSP_TYPES.FSP_STAT_SUB := 'SUB').
  private static final String STATUS_SUBMITTED = "SUB";

  // Same signal fsp_common_validation uses to derive fspExtensionStat = 'S'
  // (V9.00203 FSP_COMMON_VALIDATION.sql:808-812): an extension row on this
  // FSP still in SUB status.
  private static final String OPEN_EXTENSION_COUNT_SQL =
      "SELECT COUNT(1) FROM the.fsp_extension "
          + "WHERE fsp_id = ? AND fsp_status_code = ?";

  // Attachments linked to one extension via fsp_extension_xref. The same
  // two-table join FSP_700_WORKFLOW uses to count the EXDDMD letter
  // (V9.00195:709-715), widened to return every linked row for the
  // Extension Summary dialog.
  private static final String EXTENSION_ATTACHMENTS_SQL =
      "SELECT fa.fsp_attachment_id AS attachment_id, "
          + "       fa.attachment_name AS attachment_name, "
          + "       fa.fsp_attachment_type_code AS type_code "
          + "  FROM the.fsp_extension_xref fex "
          + "  JOIN the.fsp_attachment fa "
          + "    ON fa.fsp_attachment_id = fex.fsp_attachment_id "
          + " WHERE fex.extension_id = ? "
          + " ORDER BY fa.fsp_attachment_id";

  private final JdbcTemplate jdbcTemplate;

  public FspExtensionQueryDaoImpl(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  @Override
  public boolean hasOpenExtension(long fspId) {
    Integer count = jdbcTemplate.queryForObject(
        OPEN_EXTENSION_COUNT_SQL, Integer.class, fspId, STATUS_SUBMITTED);
    return count != null && count > 0;
  }

  @Override
  public java.util.List<ExtensionAttachment> findExtensionAttachments(long extensionId) {
    return jdbcTemplate.query(
        EXTENSION_ATTACHMENTS_SQL,
        (rs, rowNum) -> new ExtensionAttachment(
            rs.getString("attachment_id"),
            rs.getString("attachment_name"),
            rs.getString("type_code")),
        extensionId);
  }
}
