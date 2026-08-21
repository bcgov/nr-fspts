package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp600MapDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp600MapDirectDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.StoredProcedureException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Direct-SQL implementation of {@link Fsp600MapDirectDao}. See the
 * interface for why this exists. Every query below is a port of the
 * corresponding read inside {@code FSP_600_MAP.GET} /
 * {@code fsp_tombstone.get}.
 */
@Repository
@Slf4j
public class Fsp600MapDirectDaoImpl implements Fsp600MapDirectDao {

  /** {@code fsp_types.fsp_stat_del} — package constants aren't visible to SQL. */
  private static final String STATUS_DELETED = "DEL";

  /** Same key {@code fsp_tombstone.get} appends when the FSP id has no rows. */
  private static final String NO_RECORDS = "fsp.web.warning.fsp.noRecordsFound:~W;";
  /** Same key it appends when no amendment is visible to the caller. */
  private static final String NO_ACCESS = "fsp.web.error.no_access_right;";

  private static final String EXISTS_SQL =
      "SELECT COUNT('x') FROM the.forest_stewardship_plan WHERE fsp_id = ?";

  // Verbatim port of fsp_tombstone.get's "determine the most recent
  // amendment that the user can access" query, taken on the branch our
  // callers always hit (p_fsp_id blank, p_new_fsp_id set, no amendment).
  private static final String RESOLVE_AMENDMENT_SQL = """
      SELECT MAX(fsp.fsp_amendment_number)
        FROM the.forest_stewardship_plan fsp
       WHERE fsp.fsp_id = ?
         AND fsp.fsp_status_code <> ?
         AND the.fsp_tombstone.user_may_access(fsp.fsp_id,
                                               fsp.fsp_amendment_number,
                                               ?,
                                               ?) = 'Y'
      """;

  // The proc's p_fdu_map_results cursor. get_fdu_licenses builds its
  // comma-space-joined string from DISTINCT forest_file_id for the
  // fsp/amendment/fdu; FDUL_PK is (FSP_ID, FSP_AMENDMENT_NUMBER, FDU_ID,
  // FOREST_FILE_ID) so duplicates can't exist and a plain LISTAGG over the
  // outer join is equivalent. An FDU with no licences yields NULL, which
  // is what the function returns too.
  private static final String FDU_ROWS_SQL = """
      SELECT fdu.fdu_id,
             fdu.fdu_name,
             LISTAGG(flx.forest_file_id, ', ')
               WITHIN GROUP (ORDER BY flx.forest_file_id) fdu_licences
        FROM the.forest_development_unit fdu
        LEFT JOIN the.fdu_licence_xref flx
               ON flx.fsp_id = fdu.fsp_id
              AND flx.fsp_amendment_number = fdu.fsp_amendment_number
              AND flx.fdu_id = fdu.fdu_id
       WHERE fdu.fsp_id = ?
         AND fdu.fsp_amendment_number = ?
       GROUP BY fdu.fdu_id, fdu.fdu_name
       ORDER BY fdu.fdu_name
      """;

  // get_fdu_amendment, made deterministic. The join is intentionally the
  // proc's (fsp_id + fdu_id, no amendment predicate on fdug) because that
  // is what lets a copied-forward FDU find the geometry still sitting at
  // the amendment it was submitted under. MAX only decides which one wins
  // when there is more than one — the case the proc crashes on.
  private static final String GEOMETRY_AMENDMENT_SQL = """
      SELECT MAX(fdug.fsp_amendment_number)
        FROM the.forest_development_unit fdu
        JOIN the.forest_development_unit_geom fdug
          ON fdug.fsp_id = fdu.fsp_id
         AND fdug.fdu_id = fdu.fdu_id
       WHERE fdu.fsp_id = ?
         AND fdu.fsp_amendment_number = ?
      """;

  private final JdbcTemplate jdbc;

  public Fsp600MapDirectDaoImpl(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  @Override
  public Fsp600MapDao.Result get(String fspId, String userClientNumber, String userRole) {
    final long fspIdLong;
    try {
      fspIdLong = Long.parseLong(fspId == null ? "" : fspId.trim());
    } catch (NumberFormatException e) {
      // The proc would compare a non-numeric id against a NUMBER column and
      // blow up; treat it as "no such FSP", the same shape as an unknown id.
      return new Fsp600MapDao.Result(null, List.of(), NO_RECORDS);
    }

    Integer count = jdbc.queryForObject(EXISTS_SQL, Integer.class, fspIdLong);
    if (count == null || count == 0) {
      // fsp_tombstone.get emits this as a :~W warning and returns an empty
      // result rather than failing — mirror that.
      log.debug("FSP {} has no rows; returning empty FDU list", fspIdLong);
      return new Fsp600MapDao.Result(null, List.of(), NO_RECORDS);
    }

    Long amendment = jdbc.queryForObject(
        RESOLVE_AMENDMENT_SQL, Long.class,
        fspIdLong, STATUS_DELETED, userClientNumber, userRole);
    if (amendment == null) {
      // No amendment passes user_may_access. The proc appends the same key
      // with no :~ marker, which AbstractStoredProcedureDao.throwIfError
      // treats as fatal — and ProcErrorMessages maps to 403.
      log.info("FDU list for FSP {} denied for client={} roles={}",
          fspIdLong, userClientNumber, userRole);
      throw new StoredProcedureException(
          Fsp600MapDao.PACKAGE_NAME, Fsp600MapDao.PROCEDURE_NAME, NO_ACCESS);
    }

    List<Fsp600MapDao.FduRow> fdus = jdbc.query(
        FDU_ROWS_SQL,
        (rs, rowNum) -> new Fsp600MapDao.FduRow(
            rs.getString(1), rs.getString(2), rs.getString(3)),
        fspIdLong, amendment);

    Long geometryAmendment = jdbc.queryForObject(
        GEOMETRY_AMENDMENT_SQL, Long.class, fspIdLong, amendment);

    return new Fsp600MapDao.Result(
        geometryAmendment == null ? null : Long.toString(geometryAmendment),
        fdus,
        null);
  }
}
