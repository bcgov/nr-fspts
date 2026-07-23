package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.FspWorkflowQueryDao;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class FspWorkflowQueryDaoImpl implements FspWorkflowQueryDao {

  // Mirrors FSP_700_WORKFLOW.get_ddm_only (V9.00195) but WITHOUT its
  // "fsh.fsp_status_code = p_fsp_status_code" clause — so a retired (RET)
  // amendment still yields the Approved/In-Effect/Rejected decision that
  // was recorded on it. Dates use YYYY-MM-DD to match the proc's
  // fsp_common.convert_to_char default.
  private static final String FIND_DECISION_SQL =
      "SELECT fsh.fsp_status_code AS status_code, "
          + "       fsh.entry_userid AS decided_by, "
          + "       TO_CHAR(fsp.amendment_submission_date, 'YYYY-MM-DD') AS submission_date, "
          + "       TO_CHAR(fsp.plan_decision_date, 'YYYY-MM-DD') AS decision_date, "
          + "       TO_CHAR(fsp.plan_start_date, 'YYYY-MM-DD') AS effective_date, "
          + "       fsh.status_comment AS status_comment "
          + "  FROM the.forest_stewardship_plan fsp "
          + "  JOIN the.fsp_status_history fsh "
          + "    ON fsh.fsp_id = fsp.fsp_id "
          + "   AND fsh.fsp_amendment_number = fsp.fsp_amendment_number "
          + " WHERE fsp.fsp_id = ? "
          + "   AND fsp.fsp_amendment_number = ? "
          + "   AND fsh.fsp_status_history_id = ( "
          + "         SELECT MAX(fsp_status_history_id) "
          + "           FROM the.fsp_status_history "
          + "          WHERE fsp_status_code IN ('APP','INE','REJ') "
          + "            AND fsp_id = ? "
          + "            AND fsp_amendment_number = ? "
          + "            AND extension_id IS NULL)";

  // Plan-level amendment approval date, formatted to match the proc's
  // fsp_common.convert_to_char default (YYYY-MM-DD). FSP_700 never returns
  // this column, so the DDM Decision tile reads it here.
  private static final String FIND_AMENDMENT_APPROVAL_DATE_SQL =
      "SELECT TO_CHAR(amendment_approval_date, 'YYYY-MM-DD') "
          + "  FROM the.forest_stewardship_plan "
          + " WHERE fsp_id = ? "
          + "   AND fsp_amendment_number = ?";

  private final JdbcTemplate jdbcTemplate;

  public FspWorkflowQueryDaoImpl(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  @Override
  public RecordedDecision findRecordedDecision(long fspId, long amendmentNumber) {
    try {
      return jdbcTemplate.queryForObject(
          FIND_DECISION_SQL,
          (rs, rowNum) -> new RecordedDecision(
              rs.getString("status_code"),
              rs.getString("decided_by"),
              rs.getString("submission_date"),
              rs.getString("decision_date"),
              rs.getString("effective_date"),
              rs.getString("status_comment")),
          fspId, amendmentNumber, fspId, amendmentNumber);
    } catch (EmptyResultDataAccessException e) {
      return null;
    }
  }

  @Override
  public String findAmendmentApprovalDate(long fspId, long amendmentNumber) {
    try {
      return jdbcTemplate.queryForObject(
          FIND_AMENDMENT_APPROVAL_DATE_SQL,
          String.class,
          fspId, amendmentNumber);
    } catch (EmptyResultDataAccessException e) {
      return null;
    }
  }
}
