package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp600MapDao;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Types;

@Repository
public class Fsp600MapDaoImpl extends AbstractStoredProcedureDao implements Fsp600MapDao {

  // 17 positional params on FSP_600_MAP.GET — see the package body
  // (R__06403_FSP_600_MAP.sql) for the full signature.
  private static final int PARAM_COUNT = 17;
  private static final String CALL = callSql(PACKAGE_NAME, PROCEDURE_NAME, PARAM_COUNT);

  public Fsp600MapDaoImpl(JdbcTemplate jdbcTemplate) {
    super(jdbcTemplate);
  }

  @Override
  public Result get(String fspId, String userClientNumber, String userRole) {
    return executeCall(CALL,
        cs -> {
          // Same fsp_tombstone.get binding contract as FSP_300/400/500:
          // FSP id flows in via P_NEW_FSP_ID, P_FSP_ID blank; amendment
          // slots blank so the proc resolves the most-recent accessible
          // amendment. Audit-user context (client/role) from the JWT.
          setInOutString(cs, 1, "");                  // p_fsp_id
          setInOutString(cs, 2, fspId);               // p_new_fsp_id
          cs.registerOutParameter(3, Types.VARCHAR);  // p_fsp_plan_name OUT
          cs.registerOutParameter(4, Types.ARRAY, ORG_UNIT_VARRAY_TYPE); // p_fsp_org_units OUT
          cs.registerOutParameter(5, Types.VARCHAR);  // p_fsp_status_code OUT
          cs.registerOutParameter(6, Types.VARCHAR);  // p_fsp_status_desc OUT
          setInOutString(cs, 7, "");                  // p_fsp_amendment_number
          setInOutString(cs, 8, "");                  // p_new_fsp_amendment_number
          setInOutString(cs, 9, userClientNumber);    // p_user_client_number
          setInOutString(cs, 10, userRole);           // p_user_role
          cs.registerOutParameter(11, Types.VARCHAR); // p_submission_id OUT
          cs.registerOutParameter(12, Types.VARCHAR); // p_fsp_expiry_date OUT
          cs.registerOutParameter(13, Types.VARCHAR); // p_amendment_name OUT
          cs.registerOutParameter(14, Types.VARCHAR); // p_amendment_efftv_date OUT
          cs.registerOutParameter(15, Types.VARCHAR); // fdu_amendment_number OUT
          registerOutCursor(cs, 16);                  // p_fdu_map_results REF CURSOR
          cs.registerOutParameter(17, Types.VARCHAR); // p_error_message OUT
        },
        cs -> {
          var rows = readCursor(cs, 16, rs -> new FduRow(
              rs.getString(1),  // fdu_id
              rs.getString(2),  // fdu_name
              rs.getString(3)   // fdu_licences
          ));
          Result r = new Result(cs.getString(15), rows, cs.getString(17));
          throwIfError(PACKAGE_NAME, PROCEDURE_NAME, r.errorMessage());
          return r;
        });
  }
}
