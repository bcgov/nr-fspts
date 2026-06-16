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
        fspId, amendmentNumber, fduId, normaliseLicence(forestFileId), userId, userId);
  }

  @Override
  public void removeFduLicence(
      long fspId, long amendmentNumber, long fduId, String forestFileId) {
    jdbc.update(
        "DELETE FROM FDU_LICENCE_XREF "
            + "WHERE FSP_ID = ? AND FSP_AMENDMENT_NUMBER = ? AND FDU_ID = ? "
            + "  AND FOREST_FILE_ID = ?",
        fspId, amendmentNumber, fduId, normaliseLicence(forestFileId));
  }

  @Override
  public boolean licenceExists(String forestFileId) {
    if (forestFileId == null || forestFileId.isBlank()) return false;
    Integer count = jdbc.queryForObject(
        "SELECT COUNT(*) FROM PROV_FOREST_USE WHERE FOREST_FILE_ID = ?",
        Integer.class, normaliseLicence(forestFileId));
    return count != null && count > 0;
  }

  /**
   * Normalise a licence number to the canonical form stored in
   * {@code PROV_FOREST_USE}: trimmed of surrounding whitespace and
   * upper-cased. Source paths (XML submission, edit dialog, etc.) feed
   * raw user input; centralising the normalisation here keeps every
   * write and every existence check consistent so a {@code "a12345"}
   * submission can't pass {@link #licenceExists} as {@code "A12345"}
   * and then trip FDUL_PFU_FK on the un-normalised insert.
   */
  private static String normaliseLicence(String raw) {
    return raw == null ? null : raw.trim().toUpperCase();
  }

  @Override
  public String findFspStatus(long fspId, long amendmentNumber) {
    try {
      return jdbc.queryForObject(
          "SELECT FSP_STATUS_CODE FROM FOREST_STEWARDSHIP_PLAN "
              + "WHERE FSP_ID = ? AND FSP_AMENDMENT_NUMBER = ?",
          String.class, fspId, amendmentNumber);
    } catch (org.springframework.dao.EmptyResultDataAccessException e) {
      return null;
    }
  }

  @Override
  public boolean fduHasLicence(
      long fspId, long amendmentNumber, long fduId, String forestFileId) {
    if (forestFileId == null || forestFileId.isBlank()) return false;
    Integer count = jdbc.queryForObject(
        "SELECT COUNT(*) FROM FDU_LICENCE_XREF "
            + "WHERE FSP_ID = ? AND FSP_AMENDMENT_NUMBER = ? AND FDU_ID = ? "
            + "  AND FOREST_FILE_ID = ?",
        Integer.class, fspId, amendmentNumber, fduId, normaliseLicence(forestFileId));
    return count != null && count > 0;
  }

  @Override
  public int clearFdusForAmendment(long fspId, long amendmentNumber) {
    // Drop licence-xref rows first — they FK to FDU header. Geometry
    // rows are wiped too; fdu_copy doesn't populate them on the new
    // amendment but a previously failed submission run might have, and
    // the FSP_600_MAP.GET proc joins fdu × fdug on (fsp_id, fdu_id)
    // only — leaving stale geometry rows under a still-present FDU
    // header trips ORA-01422.
    jdbc.update(
        "DELETE FROM FDU_LICENCE_XREF "
            + "WHERE FSP_ID = ? AND FSP_AMENDMENT_NUMBER = ?",
        fspId, amendmentNumber);
    jdbc.update(
        "DELETE FROM FOREST_DEVELOPMENT_UNIT_GEOM "
            + "WHERE FSP_ID = ? AND FSP_AMENDMENT_NUMBER = ?",
        fspId, amendmentNumber);
    return jdbc.update(
        "DELETE FROM FOREST_DEVELOPMENT_UNIT "
            + "WHERE FSP_ID = ? AND FSP_AMENDMENT_NUMBER = ?",
        fspId, amendmentNumber);
  }

  @Override
  public int deleteLatestUpdHistoryRow(long fspId, long amendmentNumber) {
    // FSP_STATUS_HISTORY_ID is sequence-allocated, so the max-id row
    // for (fsp_id, amendment, 'UPD') is the most recent insert. Using
    // a subquery rather than ORDER BY ... ROWNUM=1 because Oracle
    // forbids the latter inside a DELETE.
    return jdbc.update(
        "DELETE FROM FSP_STATUS_HISTORY "
            + "WHERE FSP_ID = ? "
            + "  AND FSP_AMENDMENT_NUMBER = ? "
            + "  AND FSP_STATUS_CODE = 'UPD' "
            + "  AND FSP_STATUS_HISTORY_ID = ( "
            + "    SELECT MAX(FSP_STATUS_HISTORY_ID) "
            + "      FROM FSP_STATUS_HISTORY "
            + "     WHERE FSP_ID = ? "
            + "       AND FSP_AMENDMENT_NUMBER = ? "
            + "       AND FSP_STATUS_CODE = 'UPD')",
        fspId, amendmentNumber, fspId, amendmentNumber);
  }

  @Override
  public int retirePriorApprovedAmendments(
      long fspId, long currentAmendmentNumber, String userId) {
    // Count siblings first so the caller has something to log — the
    // proc is fire-and-forget and doesn't tell us how many rows it
    // touched. Cheap SELECT against grants we already have.
    Integer priorCount = jdbc.queryForObject(
        "SELECT COUNT(*) FROM FOREST_STEWARDSHIP_PLAN "
            + "WHERE FSP_ID = ? "
            + "  AND FSP_AMENDMENT_NUMBER <> ? "
            + "  AND FSP_STATUS_CODE IN ('APP','INE')",
        Integer.class, fspId, currentAmendmentNumber);
    if (priorCount == null || priorCount == 0) return 0;

    // Delegate to the public proc fsp_common_db.fsp_status_cancel —
    // it inserts CAN history rows for DFT/SUB sibling amendments and
    // RET history rows for APP/INE sibling amendments (excluding the
    // current one). The proc runs as definer 'THE' and is already
    // granted via the FSP_AGENT / FSP_SUBMITTER / FSP_ADMINISTRATOR
    // roles the proxy user inherits, so we don't need direct INSERT
    // grants on FSP_STATUS_HISTORY (which fail with ORA-942 under our
    // proxy user). The proc does NOT update
    // FOREST_STEWARDSHIP_PLAN.fsp_status_code — fsp_approval does that
    // separately at approval time. The History tab (the user-visible
    // artifact we're matching to legacy) reads from fsp_status_history,
    // so the RET event shows up immediately even with the FSP row's
    // status code unchanged.
    jdbc.update(
        "{call fsp_common_db.fsp_status_cancel(?, ?, ?, ?)}",
        fspId, currentAmendmentNumber, null, userId);
    return priorCount;
  }

  @Override
  public Long findMaxApprovedAmendmentNumber(long fspId) {
    // Mirrors FSP_COMMON_DB.get_max_approved_amendment — MAX over
    // amendments whose status is APP or INE. MAX returns null when no
    // row matches; we surface that as Java null so the caller can 409
    // before the proc silently inserts 0 rows.
    return jdbc.queryForObject(
        "SELECT MAX(FSP_AMENDMENT_NUMBER) FROM FOREST_STEWARDSHIP_PLAN "
            + "WHERE FSP_ID = ? AND FSP_STATUS_CODE IN ('APP','INE')",
        Long.class, fspId);
  }
}
