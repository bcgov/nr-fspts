package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.IdentifiedAreaWriteDao;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
@Slf4j
public class IdentifiedAreaWriteDaoImpl implements IdentifiedAreaWriteDao {

  private final JdbcTemplate jdbc;
  private final Long configuredSkey;
  private volatile Long cachedSkey;

  public IdentifiedAreaWriteDaoImpl(
      JdbcTemplate jdbc,
      @Value("${fsp.feature-class.identified-area-skey:#{null}}") Long configuredSkey) {
    this.jdbc = jdbc;
    this.configuredSkey = configuredSkey;
  }

  @Override
  public long nextIdentifiedAreaId() {
    // Definer-rights wrapper — see FduWriteDaoImpl#nextFduId for
    // rationale. The role often has EXECUTE on FSP_COMMON_DB but
    // lacks SELECT on FSP_IDENTIFIED_AREA_SEQ directly.
    Long id = jdbc.queryForObject(
        "SELECT FSP_COMMON_DB.get_new_identified_area_id() FROM DUAL", Long.class);
    if (id == null) {
      throw new IllegalStateException(
          "FSP_COMMON_DB.get_new_identified_area_id returned null");
    }
    return id;
  }

  @Override
  public long lookupIdentifiedAreaFeatureClassSkey() {
    // See FduWriteDaoImpl for the rationale — DBA-side grants gap on
    // FEATURE_CLASSES means the property override is the only safe
    // path on some dev databases.
    if (configuredSkey != null) {
      return configuredSkey;
    }
    Long cached = cachedSkey;
    if (cached != null) {
      return cached;
    }
    try {
      Long skey = jdbc.queryForObject(
          "SELECT FEATURE_CLASS_SKEY FROM FEATURE_CLASSES WHERE NAME = 'Identified Area'",
          Long.class);
      if (skey == null) {
        throw new IllegalStateException(
            "FEATURE_CLASSES has no row named 'Identified Area'. "
                + "Set fsp.feature-class.identified-area-skey explicitly.");
      }
      cachedSkey = skey;
      return skey;
    } catch (org.springframework.jdbc.BadSqlGrammarException e) {
      throw new IllegalStateException(
          "Cannot SELECT from FEATURE_CLASSES (likely missing DBA grants on this DB role). "
              + "Set fsp.feature-class.identified-area-skey in application.properties "
              + "to bypass the runtime lookup with a known constant — query "
              + "SELECT DISTINCT feature_class_skey FROM fsp_identified_area_geometry "
              + "to find the right value.",
          e);
    }
  }

  @Override
  public void insertIdentifiedAreaHeader(
      long fspId,
      long amendmentNumber,
      long identifiedAreaId,
      String legislationTypeCode,
      String identifiedAreaName,
      String userId) {
    // Header table uses ENTRY_USER_ID (with underscore) — unlike FDU's
    // ENTRY_USERID. Easy to miss in a copy-paste so keep the column
    // list explicit.
    jdbc.update(
        "INSERT INTO FSP_IDENTIFIED_AREA "
            + "(FSP_ID, FSP_AMENDMENT_NUMBER, IDENTIFIED_AREA_ID, "
            + " FSP_LEGISLATION_TYPE_CODE, IDENTIFIED_AREA_NAME, REVISION_COUNT, "
            + " ENTRY_USER_ID, ENTRY_TIMESTAMP, UPDATE_USERID, UPDATE_TIMESTAMP) "
            + "VALUES (?, ?, ?, ?, ?, 1, ?, SYSDATE, ?, SYSDATE)",
        fspId,
        amendmentNumber,
        identifiedAreaId,
        legislationTypeCode,
        identifiedAreaName,
        userId,
        userId);
  }

  @Override
  public void insertIdentifiedAreaGeometry(
      long fspId,
      long amendmentNumber,
      long identifiedAreaId,
      long featureClassSkey,
      String wkt,
      int srid,
      double featureAreaHa,
      double featurePerimeterKm,
      String userId) {
    String sql = """
        DECLARE
          v_geom MDSYS.SDO_GEOMETRY;
        BEGIN
          v_geom := SDO_UTIL.FROM_WKTGEOMETRY(?);
          v_geom.SDO_SRID := ?;
          INSERT INTO FSP_IDENTIFIED_AREA_GEOMETRY
            (FSP_ID, FSP_AMENDMENT_NUMBER, IDENTIFIED_AREA_ID, FEATURE_CLASS_SKEY, GEOMETRY,
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
        identifiedAreaId,
        featureClassSkey,
        featureAreaHa,
        featurePerimeterKm,
        userId,
        userId);
  }
}
