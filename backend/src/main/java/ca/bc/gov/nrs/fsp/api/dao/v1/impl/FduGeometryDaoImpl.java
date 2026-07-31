package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FduGeometryDao;
import oracle.jdbc.OracleTypes;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Struct;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Repository
public class FduGeometryDaoImpl extends AbstractStoredProcedureDao implements FduGeometryDao {

  private static final String SP_FDU_BY_ID = "{ ? = call " + PACKAGE_NAME + ".fdu_geometry_gets(?) }";

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
    // Direct query rather than FSP_COMMON.fdu_geometry_gets: that proc's cursor
    // selects the geometry only, and we need the FDU name too (for the map
    // label). The join replicates the proc exactly — the FDU row at the
    // requested fsp+amendment, its geometry matched by fdu_id — so the same
    // polygons render. GEOMETRY stays the FIRST column so callers that read the
    // first map entry as the SDO_GEOMETRY (FspExtentService, the GeoJSON
    // service) are unaffected; FDU_NAME rides along as a second column.
    return jdbcTemplate.query(
        "SELECT fdug.geometry, fdu.fdu_name "
            + "FROM forest_development_unit_geom fdug, forest_development_unit fdu "
            + "WHERE fdu.fsp_id = ? "
            + "AND fdu.fsp_amendment_number = ? "
            + "AND fdu.fdu_id = fdug.fdu_id",
        (rs, rowNum) -> {
          Map<String, Object> row = new LinkedHashMap<>(2);
          row.put("GEOMETRY", rs.getObject(1));
          row.put("FDU_NAME", rs.getString(2));
          return new FduGeometryRow(row);
        },
        fspId,
        fspAmendmentNumber);
  }
}
