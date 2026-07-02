package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FduGeometryDao;
import oracle.jdbc.OracleTypes;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Struct;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Repository
public class FduGeometryDaoImpl extends AbstractStoredProcedureDao implements FduGeometryDao {

  private static final String SP_FDU_BY_ID = "{ ? = call " + PACKAGE_NAME + ".fdu_geometry_gets(?) }";
  private static final String SP_FDU_BY_FSP_AMEND = "{ ? = call " + PACKAGE_NAME + ".fdu_geometry_gets(?,?) }";

  public FduGeometryDaoImpl(JdbcTemplate jdbcTemplate) {
    super(jdbcTemplate);
  }

  @Override
  public Struct getFduGeometry(int fduId) {
    return executeCall(SP_FDU_BY_ID,
        cs -> {
          cs.registerOutParameter(1, OracleTypes.STRUCT, "MDSYS.SDO_GEOMETRY");
          cs.setInt(2, fduId);
        },
        cs -> (Struct) cs.getObject(1));
  }

  @Override
  public List<FduGeometryRow> getFduGeometry(int fspId, int fspAmendmentNumber) {
    return executeCall(SP_FDU_BY_FSP_AMEND,
        cs -> {
          cs.registerOutParameter(1, OracleTypes.CURSOR);
          cs.setInt(2, fspId);
          cs.setInt(3, fspAmendmentNumber);
        },
        cs -> {
          List<FduGeometryRow> out = new java.util.ArrayList<>();
          Object obj = cs.getObject(1);
          if (obj instanceof ResultSet rs) {
            try (ResultSet auto = rs) {
              ResultSetMetaData md = auto.getMetaData();
              while (auto.next()) {
                Map<String, Object> row = new LinkedHashMap<>(md.getColumnCount());
                for (int i = 1; i <= md.getColumnCount(); i++) {
                  row.put(md.getColumnLabel(i), auto.getObject(i));
                }
                out.add(new FduGeometryRow(row));
              }
            }
          }
          return out;
        });
  }
}
