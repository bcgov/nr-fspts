package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AmendmentRevertDao;
import oracle.jdbc.OracleTypes;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.CallableStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Repository
public class AmendmentRevertDaoImpl implements AmendmentRevertDao {

  private final JdbcTemplate jdbc;

  public AmendmentRevertDaoImpl(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public Optional<AmendmentRow> findAmendment(long fspId, long amendmentNumber) {
    List<AmendmentRow> rows = jdbc.query(
        "SELECT fsp_status_code, fsp_amendment_code, amendment_submission_date "
            + "  FROM forest_stewardship_plan "
            + " WHERE fsp_id = ? AND fsp_amendment_number = ?",
        (rs, i) -> new AmendmentRow(rs.getString(1), rs.getString(2), rs.getTimestamp(3)),
        fspId, amendmentNumber);
    return rows.stream().findFirst();
  }

  @Override
  public int countLaterLiveAmendments(long fspId, long amendmentNumber) {
    Integer n = jdbc.queryForObject(
        "SELECT COUNT(*) FROM forest_stewardship_plan "
            + " WHERE fsp_id = ? AND fsp_amendment_number > ? "
            + "   AND fsp_status_code IN ('DFT','SUB','OHS','APP','INE')",
        Integer.class, fspId, amendmentNumber);
    return n == null ? 0 : n;
  }

  @Override
  public int countExtensionsOnAmendment(long fspId, long amendmentNumber) {
    Integer n = jdbc.queryForObject(
        "SELECT COUNT(*) FROM fsp_extension "
            + " WHERE fsp_id = ? AND fsp_amendment_number = ? "
            + "   AND fsp_status_code IN ('APP','SUB')",
        Integer.class, fspId, amendmentNumber);
    return n == null ? 0 : n;
  }

  @Override
  public List<LinkedStandard> findNonDefaultStandards(long fspId, long amendmentNumber) {
    // Same filter as standards_regime_cur in fsp_common_db.fsp_status_update.
    return jdbc.query(
        "SELECT sr.standards_regime_id, sr.standards_regime_name, "
            + "       sr.standards_regime_status_code "
            + "  FROM fsp_standards_regime_xref fsrx, standards_regime sr "
            + " WHERE fsrx.fsp_id = ? AND fsrx.fsp_amendment_number = ? "
            + "   AND sr.standards_regime_id = fsrx.standards_regime_id "
            + "   AND (sr.mof_default_standard_ind IS NULL OR sr.mof_default_standard_ind <> 'Y') "
            + " ORDER BY sr.standards_regime_id",
        (rs, i) -> new LinkedStandard(rs.getLong(1), rs.getString(2), rs.getString(3)),
        fspId, amendmentNumber);
  }

  @Override
  public void setStandardStatus(long regimeId, String statusCode) {
    jdbc.update(
        "UPDATE standards_regime SET standards_regime_status_code = ? "
            + " WHERE standards_regime_id = ?",
        statusCode, regimeId);
  }

  /**
   * reset → status update → open the error cursor, all in one anonymous
   * block: {@code FSP_ERROR_MESSAGES_TEMP} is ON COMMIT DELETE ROWS, so the
   * cursor has to be opened before anything commits (same reasoning as
   * {@link FspValidationDaoImpl#validate}). The 6-argument overload is the
   * public one; it forces the proc-computed housekeeping dates, which the
   * service then corrects with {@link #clearApprovalFields}.
   */
  @Override
  public List<ProcError> updateStatus(
      long fspId, long amendmentNumber, String statusCode, String comment, String userId) {
    return jdbc.execute((java.sql.Connection con) -> {
      try (CallableStatement cs = con.prepareCall(
          "BEGIN "
              + "  fsp_error.reset_errors; "
              + "  fsp_common_db.fsp_status_update(?, ?, NULL, ?, ?, ?); "
              + "  OPEN ? FOR "
              + "    SELECT error_key, "
              + "           fsp_common.format_error_message(error_message, error_parameters) "
              + "      FROM fsp_error_messages_temp "
              + "     ORDER BY entry_timestamp, fsp_error_messages_id; "
              + "END;")) {
        cs.setLong(1, fspId);
        cs.setLong(2, amendmentNumber);
        cs.setString(3, statusCode);
        cs.setString(4, comment);
        cs.setString(5, userId);
        cs.registerOutParameter(6, OracleTypes.CURSOR);
        cs.execute();
        List<ProcError> out = new ArrayList<>();
        try (ResultSet rs = (ResultSet) cs.getObject(6)) {
          while (rs.next()) {
            out.add(new ProcError(rs.getString(1), rs.getString(2)));
          }
        }
        try (CallableStatement reset = con.prepareCall("BEGIN fsp_error.reset_errors; END;")) {
          reset.execute();
        }
        return out;
      }
    });
  }

  @Override
  public Long findLatestHistoryId(long fspId, long amendmentNumber, String statusCode) {
    return jdbc.queryForObject(
        "SELECT MAX(fsp_status_history_id) FROM fsp_status_history "
            + " WHERE fsp_id = ? AND fsp_amendment_number = ? AND fsp_status_code = ?",
        Long.class, fspId, amendmentNumber, statusCode);
  }

  @Override
  public int clearApprovalFields(
      long fspId, long amendmentNumber, Timestamp submissionDate, String userId) {
    return jdbc.update(
        "UPDATE forest_stewardship_plan "
            + "   SET amendment_approval_date = NULL, "
            + "       amendment_authority = NULL, "
            + "       plan_decision_date = NULL, "
            + "       plan_decision_userid = NULL, "
            + "       amendment_submission_date = ?, "
            + "       update_userid = ?, "
            + "       update_timestamp = SYSDATE, "
            + "       revision_count = revision_count + 1 "
            + " WHERE fsp_id = ? AND fsp_amendment_number = ?",
        submissionDate, userId, fspId, amendmentNumber);
  }
}
