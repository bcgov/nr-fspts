package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp303ExtensionSummaryDao;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class Fsp303ExtensionSummaryDaoImpl extends AbstractStoredProcedureDao
    implements Fsp303ExtensionSummaryDao {

  // The GET_LIST proc has 12 params: 7 scalar OUTs, 1 REF CURSOR, 4 audit/error
  // INOUTs (client, role, userid, error). All positions are 1-indexed.
  private static final int PARAM_COUNT = 12;
  private static final String CALL = callSql(PACKAGE_NAME, PROCEDURE_NAME, PARAM_COUNT);

  public Fsp303ExtensionSummaryDaoImpl(JdbcTemplate jdbcTemplate) {
    super(jdbcTemplate);
  }

  @Override
  public Result getList(String fspId, String userClientNumber, String userRole, String userId) {
    return executeCall(CALL,
        cs -> {
          setInOutString(cs, 1, fspId);
          setInOutString(cs, 2, "");   // p_fsp_plan_name OUT
          setInOutString(cs, 3, "");   // p_orig_fsp_effective_date OUT
          setInOutString(cs, 4, "");   // p_orig_fsp_expiry_date OUT
          setInOutString(cs, 5, "");   // p_curr_plan_term_years OUT
          setInOutString(cs, 6, "");   // p_curr_plan_term_months OUT
          setInOutString(cs, 7, "");   // p_curr_fsp_expiry_date OUT
          registerOutCursor(cs, 8);    // p_extensions REF CURSOR
          setInOutString(cs, 9, userClientNumber);
          setInOutString(cs, 10, userRole);
          setInOutString(cs, 11, userId);
          setInOutString(cs, 12, "");  // p_error_message OUT
        },
        cs -> {
          // Read the cursor row-by-row, mapping each SELECT-list position
          // into the ExtensionRow record. The cursor query lives in the
          // package body and we read columns positionally because the
          // cursor was OPEN-FOR'd without column aliases on every field.
          var rows = readCursor(cs, 8, rs -> new ExtensionRow(
              rs.getString(1),   // extension_id
              rs.getString(2),   // extension_number
              rs.getString(3),   // fsp_status_code
              rs.getString(4),   // status description
              rs.getString(5),   // plan_term_years
              rs.getString(6),   // plan_term_months
              rs.getString(7),   // plan_start_date
              rs.getString(8),   // plan_end_date
              rs.getString(9),   // submission_date
              rs.getString(10),  // decision_date
              rs.getString(11),  // approval_date
              rs.getString(12),  // reject_date
              rs.getString(13),  // fsp_amendment_number
              rs.getString(14)   // status_comment
          ));
          Result r = new Result(
              cs.getString(1),
              cs.getString(2),
              cs.getString(3),
              cs.getString(4),
              cs.getString(5),
              cs.getString(6),
              cs.getString(7),
              rows,
              cs.getString(12));
          throwIfError(PACKAGE_NAME, PROCEDURE_NAME, r.errorMessage());
          return r;
        });
  }
}
