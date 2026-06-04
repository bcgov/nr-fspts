package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.FduWriteDao;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
@Slf4j
public class FduWriteDaoImpl implements FduWriteDao {

  private final JdbcTemplate jdbc;
  private final Long configuredSkey;
  private volatile Long cachedFduFeatureClassSkey;

  public FduWriteDaoImpl(
      JdbcTemplate jdbc,
      @Value("${fsp.feature-class.forest-development-unit-skey:#{null}}") Long configuredSkey) {
    this.jdbc = jdbc;
    this.configuredSkey = configuredSkey;
  }

  @Override
  public long nextFduId() {
    // Use the FSP_COMMON_DB wrapper function rather than the raw
    // sequence — runs with definer rights so the calling DB role only
    // needs EXECUTE on the package, not SELECT on FDU_SEQ directly
    // (which the PROXY_FSA_FSP_READ_WRITE_USER role often lacks).
    Long id = jdbc.queryForObject(
        "SELECT FSP_COMMON_DB.get_new_fdu_id() FROM DUAL", Long.class);
    if (id == null) {
      throw new IllegalStateException("FSP_COMMON_DB.get_new_fdu_id returned null");
    }
    return id;
  }

  @Override
  public long lookupFduFeatureClassSkey() {
    // Property override skips the DB lookup entirely. Useful when the
    // app's DB connection lacks SELECT on FEATURE_CLASSES (legacy
    // grants gap on the PROXY_FSA_FSP_READ_WRITE_USER role); set
    // fsp.feature-class.forest-development-unit-skey=NNNN in
    // application.properties to use a known constant instead.
    if (configuredSkey != null) {
      return configuredSkey;
    }
    Long cached = cachedFduFeatureClassSkey;
    if (cached != null) {
      return cached;
    }
    try {
      Long skey = jdbc.queryForObject(
          "SELECT FEATURE_CLASS_SKEY FROM FEATURE_CLASSES WHERE NAME = 'Forest Development Unit'",
          Long.class);
      if (skey == null) {
        throw new IllegalStateException(
            "FEATURE_CLASSES has no row named 'Forest Development Unit'. "
                + "Set fsp.feature-class.forest-development-unit-skey explicitly.");
      }
      cachedFduFeatureClassSkey = skey;
      return skey;
    } catch (org.springframework.jdbc.BadSqlGrammarException e) {
      throw new IllegalStateException(
          "Cannot SELECT from FEATURE_CLASSES (likely missing DBA grants on this DB role). "
              + "Set fsp.feature-class.forest-development-unit-skey in application.properties "
              + "to bypass the runtime lookup with a known constant — query "
              + "SELECT DISTINCT feature_class_skey FROM forest_development_unit_geom "
              + "to find the right value.",
          e);
    }
  }

  @Override
  public void insertFduHeader(
      long fspId, long amendmentNumber, long fduId, String fduName, String userId) {
    jdbc.update(
        "INSERT INTO FOREST_DEVELOPMENT_UNIT "
            + "(FSP_ID, FSP_AMENDMENT_NUMBER, FDU_ID, FDU_NAME, REVISION_COUNT, "
            + " ENTRY_USERID, ENTRY_TIMESTAMP, UPDATE_USERID, UPDATE_TIMESTAMP) "
            + "VALUES (?, ?, ?, ?, 1, ?, SYSDATE, ?, SYSDATE)",
        fspId, amendmentNumber, fduId, fduName, userId, userId);
  }

  @Override
  public void insertFduGeometry(
      long fspId,
      long amendmentNumber,
      long fduId,
      long featureClassSkey,
      String wkt,
      int srid,
      double featureAreaHa,
      double featurePerimeterKm,
      String userId) {
    // PL/SQL block so we can stamp SDO_SRID onto the parsed geometry —
    // SDO_UTIL.FROM_WKTGEOMETRY doesn't take an SRID parameter.
    String sql = """
        DECLARE
          v_geom MDSYS.SDO_GEOMETRY;
        BEGIN
          v_geom := SDO_UTIL.FROM_WKTGEOMETRY(?);
          v_geom.SDO_SRID := ?;
          INSERT INTO FOREST_DEVELOPMENT_UNIT_GEOM
            (FSP_ID, FSP_AMENDMENT_NUMBER, FDU_ID, FEATURE_CLASS_SKEY, GEOMETRY,
             FEATURE_AREA, FEATURE_PERIMETER, REVISION_COUNT,
             ENTRY_USERID, ENTRY_TIMESTAMP, UPDATE_USERID, UPDATE_TIMESTAMP)
          VALUES (?, ?, ?, ?, v_geom, ?, ?, 1, ?, SYSDATE, ?, SYSDATE);
        END;
        """;
    jdbc.update(
        sql,
        wkt,
        srid,
        fspId,
        amendmentNumber,
        fduId,
        featureClassSkey,
        featureAreaHa,
        featurePerimeterKm,
        userId,
        userId);
  }

  @Override
  public void insertFduLicence(
      long fspId, long amendmentNumber, long fduId, String forestFileId, String userId) {
    jdbc.update(
        "INSERT INTO FDU_LICENCE_XREF "
            + "(FSP_ID, FSP_AMENDMENT_NUMBER, FDU_ID, FOREST_FILE_ID, REVISION_COUNT, "
            + " ENTRY_USERID, ENTRY_TIMESTAMP, UPDATE_USERID, UPDATE_TIMESTAMP) "
            + "VALUES (?, ?, ?, ?, 1, ?, SYSDATE, ?, SYSDATE)",
        fspId, amendmentNumber, fduId, forestFileId, userId, userId);
  }
}
