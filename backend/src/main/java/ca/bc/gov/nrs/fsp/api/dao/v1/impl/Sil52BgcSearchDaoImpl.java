package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.AbstractStoredProcedureDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Sil52BgcSearchDao;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Ten positional parameters total — all INOUT:
 * <ol>
 *   <li>p_action                   (set to {@code "GET"})</li>
 *   <li>p_bgc_zone_code</li>
 *   <li>p_bgc_subzone_code</li>
 *   <li>p_bgc_variant</li>
 *   <li>p_bgc_phase</li>
 *   <li>p_bec_site_series_cd</li>
 *   <li>p_bec_site_series_phase_cd</li>
 *   <li>p_bec_seral</li>
 *   <li>p_error_message</li>
 *   <li>p_results REF CURSOR</li>
 * </ol>
 *
 * <p>The proc's filter logic only adds a predicate when the criterion is
 * non-null, so blank inputs match every row on that column. We still
 * normalize blanks to {@code null} at the boundary for cleaner logs.
 */
@Repository
public class Sil52BgcSearchDaoImpl extends AbstractStoredProcedureDao implements Sil52BgcSearchDao {

  public Sil52BgcSearchDaoImpl(JdbcTemplate jdbcTemplate) {
    super(jdbcTemplate);
  }

  @Override
  public List<Row> getBgcSearch(
      String pBgcZoneCode,
      String pBgcSubzoneCode,
      String pBgcVariant,
      String pBgcPhase,
      String pBecSiteSeriesCd,
      String pBecSiteSeriesPhaseCd,
      String pBecSeral) {
    String sql = callSql(PACKAGE_NAME, PROCEDURE_NAME, 10);
    return executeCall(sql,
        cs -> {
          setInOutString(cs, 1, ACTION_GET);
          setInOutString(cs, 2, nullIfBlank(pBgcZoneCode));
          setInOutString(cs, 3, nullIfBlank(pBgcSubzoneCode));
          setInOutString(cs, 4, nullIfBlank(pBgcVariant));
          setInOutString(cs, 5, nullIfBlank(pBgcPhase));
          setInOutString(cs, 6, nullIfBlank(pBecSiteSeriesCd));
          setInOutString(cs, 7, nullIfBlank(pBecSiteSeriesPhaseCd));
          setInOutString(cs, 8, nullIfBlank(pBecSeral));
          setInOutString(cs, 9, "");
          registerOutCursor(cs, 10);
        },
        cs -> readCursor(cs, 10, rs -> new Row(
            rs.getString("BGC_ZONE_CODE"),
            rs.getString("BGC_SUBZONE_CODE"),
            rs.getString("BGC_VARIANT"),
            rs.getString("BGC_PHASE"),
            rs.getString("BEC_SITE_SERIES_CD"),
            rs.getString("BEC_SITE_SERIES_PHASE_CD"),
            rs.getString("BEC_SERAL"),
            rs.getString("SITE_SERIES_DESC")
        )));
  }

  private static String nullIfBlank(String s) {
    if (s == null) return null;
    String trimmed = s.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }
}
