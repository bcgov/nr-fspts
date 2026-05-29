package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp900NotificationDesignateDao;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Types;
import java.util.List;

@Repository
public class Fsp900NotificationDesignateDaoImpl extends AbstractStoredProcedureDao
    implements Fsp900NotificationDesignateDao {

  private static final String CALL_GET = "{call " + PACKAGE_NAME + ".GET(?,?,?)}";
  private static final String CALL_SAVE = "{call " + PACKAGE_NAME + ".SAVE(?,?,?,?)}";
  private static final String CALL_REMOVE = "{call " + PACKAGE_NAME + ".REMOVE(?,?)}";

  public Fsp900NotificationDesignateDaoImpl(JdbcTemplate jdbcTemplate) {
    super(jdbcTemplate);
  }

  @Override
  public GetResult get(String orgUnitNo) {
    return executeCall(CALL_GET,
        cs -> {
          cs.setString(1, orgUnitNo);
          cs.registerOutParameter(2, Types.VARCHAR);  // error message
          registerOutCursor(cs, 3);
        },
        cs -> {
          // Legacy adaptor pulled the columns positionally by name
          // (DESIGNATE_ID, DESIGNATE_IDIR) — keep that pattern in case
          // the cursor order changes. Falls back to positional if the
          // names aren't present.
          List<DesignateRow> rows = readCursor(cs, 3, rs -> {
            String id = readByNameOrIndex(rs, "DESIGNATE_ID", 1);
            String idir = readByNameOrIndex(rs, "DESIGNATE_IDIR", 2);
            return new DesignateRow(id, idir);
          });
          return new GetResult(cs.getString(2), rows);
        });
  }

  @Override
  public String save(String orgUnitNo, String designateIdir, String entryUserid) {
    return executeCall(CALL_SAVE,
        cs -> {
          cs.setString(1, orgUnitNo);
          cs.setString(2, designateIdir);
          cs.setString(3, entryUserid);
          cs.registerOutParameter(4, Types.VARCHAR);  // error message
        },
        cs -> cs.getString(4));
  }

  @Override
  public String remove(String designateId) {
    return executeCall(CALL_REMOVE,
        cs -> {
          cs.setString(1, designateId);
          cs.registerOutParameter(2, Types.VARCHAR);  // error message
        },
        cs -> cs.getString(2));
  }

  private static String readByNameOrIndex(java.sql.ResultSet rs, String name, int index)
      throws java.sql.SQLException {
    try {
      return rs.getString(name);
    } catch (java.sql.SQLException ignored) {
      return rs.getString(index);
    }
  }
}
