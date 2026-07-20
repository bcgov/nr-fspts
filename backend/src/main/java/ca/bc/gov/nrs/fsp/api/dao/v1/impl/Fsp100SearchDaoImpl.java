package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp100SearchDao;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class Fsp100SearchDaoImpl extends AbstractStoredProcedureDao implements Fsp100SearchDao {

  private static final int PARAM_COUNT = 16;
  private static final String CALL = callSql(PACKAGE_NAME, PROCEDURE_NAME, PARAM_COUNT);

  public Fsp100SearchDaoImpl(JdbcTemplate jdbcTemplate) {
    super(jdbcTemplate);
  }

  @Override
  public Result mainline(
      String pAction, String pFspId, String pFspPlanName, String pOrgUnitNo,
      String pAhClientNumber, String pFspAmendmentName,
      String pEntryUserClientNumber, String pEntryUserid, String pEntryUserRole,
      String pFspDateStart, String pFspDateEnd, String pFspDateType,
      String pFspStatusCode, String pApprovalRequired,
      int maxRows) {

    return executeCall(CALL,
        cs -> {
          setInOutString(cs, 1, pAction);
          setInOutString(cs, 2, pFspId);
          setInOutString(cs, 3, pFspPlanName);
          setInOutString(cs, 4, pOrgUnitNo);
          setInOutString(cs, 5, pAhClientNumber);
          setInOutString(cs, 6, pFspAmendmentName);
          setInOutString(cs, 7, pEntryUserClientNumber);
          setInOutString(cs, 8, pEntryUserid);
          setInOutString(cs, 9, pEntryUserRole);
          setInOutString(cs, 10, pFspDateStart);
          setInOutString(cs, 11, pFspDateEnd);
          setInOutString(cs, 12, pFspDateType);
          setInOutString(cs, 13, pFspStatusCode);
          setInOutString(cs, 14, pApprovalRequired);
          registerOutCursor(cs, 15);          // P_FSP_SEARCH_RESULT
          setInOutString(cs, 16, null);        // P_ERROR_MESSAGE
        },
        cs -> {
          List<Row> rows = readCursor(cs, 15, rs -> new Row(
              rs.getString(1),  // fsp_id
              rs.getString(2),  // plan_name
              rs.getString(3),  // fsp_amendment_name
              rs.getString(4),  // org_unit_code
              rs.getString(5),  // plan_start_date
              rs.getString(6),  // plan_end_date
              rs.getString(7),  // fsp_amendment_number
              rs.getString(8),  // agreement_holder
              rs.getString(9),  // amendment_approval_requird_ind
              rs.getString(10), // fsp_status_desc
              // MAINLINE's result cursor doesn't surface the submission date;
              // this proc path is the inactive rollback (fsp.search.direct=true
              // by default) and the DirectDao DOES project it, so null is fine.
              null              // plan_submission_date
          ), maxRows);
          Header header = new Header(
              cs.getString(1),  cs.getString(2),  cs.getString(3),  cs.getString(4),
              cs.getString(5),  cs.getString(6),  cs.getString(7),  cs.getString(8),
              cs.getString(9),  cs.getString(10), cs.getString(11), cs.getString(12),
              cs.getString(13), cs.getString(14), cs.getString(16));
          throwIfError(PACKAGE_NAME, PROCEDURE_NAME, header.pErrorMessage());
          return new Result(header, rows);
        });
  }
}
