package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp650IdentifiedAreasMapDao;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Types;
import java.util.List;

@Repository
public class Fsp650IdentifiedAreasMapDaoImpl extends AbstractStoredProcedureDao
    implements Fsp650IdentifiedAreasMapDao {

  // 17 positional params on FSP_650_IDENTIFIED_AREAS_MAP.GET — see the
  // package body (R__06404_FSP_650_IDENTIFIED_AREAS_MAP.sql).
  private static final int PARAM_COUNT = 17;
  private static final String CALL = callSql(PACKAGE_NAME, PROCEDURE_NAME, PARAM_COUNT);

  public Fsp650IdentifiedAreasMapDaoImpl(JdbcTemplate jdbcTemplate) {
    super(jdbcTemplate);
  }

  @Override
  public List<IdentifiedAreaRow> get(
      String fspId, String legislationType,
      String userClientNumber, String userRole) {
    return executeCall(CALL,
        cs -> {
          // Same fsp_tombstone.get binding contract as FSP_300/400/500/600:
          // FSP id flows in via P_NEW_FSP_ID, P_FSP_ID blank, amendment
          // slots blank so the proc resolves the latest accessible
          // amendment.
          setInOutString(cs, 1, "");                  // p_fsp_id
          setInOutString(cs, 2, fspId);               // p_new_fsp_id
          cs.registerOutParameter(3, Types.VARCHAR);  // p_fsp_plan_name OUT
          cs.registerOutParameter(4, Types.ARRAY, ORG_UNIT_VARRAY_TYPE);
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
          setInOutString(cs, 15, legislationType);    // p_legislation_type INOUT
          registerOutCursor(cs, 16);                  // p_areas_map_results
          cs.registerOutParameter(17, Types.VARCHAR); // p_error_message OUT
        },
        cs -> {
          var rows = readCursor(cs, 16, rs -> new IdentifiedAreaRow(
              rs.getString(1),  // identified_area_id
              rs.getString(2)   // identified_area_name
          ));
          throwIfError(PACKAGE_NAME, PROCEDURE_NAME, cs.getString(17));
          return rows;
        });
  }
}
