package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp302ExtensionRequestDao;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class Fsp302ExtensionRequestDaoImpl extends AbstractStoredProcedureDao
    implements Fsp302ExtensionRequestDao {

  // FSP_302_EXTENSION_REQUEST.SAVE — 11 positional params, see proc body
  // R__06395_FSP_302_EXTENSION_REQUEST.sql:216-228.
  private static final String CALL_SAVE =
      "{call " + PACKAGE_NAME + ".SAVE(?,?,?,?,?,?,?,?,?,?,?)}";

  public Fsp302ExtensionRequestDaoImpl(JdbcTemplate jdbcTemplate) {
    super(jdbcTemplate);
  }

  @Override
  public SaveResult save(SaveRequest req) {
    return executeCall(CALL_SAVE,
        cs -> {
          cs.setString(1, req.fspId());                       // IN
          // INOUT — null on insert, the proc writes back the assigned id.
          setInOutString(cs, 2, req.extensionId());
          cs.setString(3, req.newPlanTermYears());            // IN
          cs.setString(4, req.newPlanTermMonths());           // IN
          cs.setString(5, req.newFspExpiryDate());            // IN
          cs.setString(6, req.statusComment());               // IN
          cs.setString(7, req.userClientNumber());            // IN
          cs.setString(8, req.userRole());                    // IN
          cs.setString(9, req.userId());                      // IN
          cs.setString(10, req.revisionCount());              // IN
          setInOutString(cs, 11, "");                         // INOUT error
        },
        cs -> {
          String error = cs.getString(11);
          throwIfError(PACKAGE_NAME, "SAVE", error);
          return new SaveResult(cs.getString(2), req.revisionCount(), error);
        });
  }
}
