package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp501StdsSrchDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp501StdsSrchDirectDao;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Direct-SQL implementation of {@link Fsp501StdsSrchDirectDao}. See the
 * interface for why this exists. The filters are a verbatim port of
 * {@code FSP_501_STDS_SRCH.MAINLINE}'s dynamic WHERE (parity test gates it).
 */
@Repository
@Slf4j
public class Fsp501StdsSrchDirectDaoImpl implements Fsp501StdsSrchDirectDao {

  private final NamedParameterJdbcTemplate jdbc;

  public Fsp501StdsSrchDirectDaoImpl(NamedParameterJdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  // The 8 result columns. BGC reproduces the proc's FIRST_VALUE over the
  // site-series via MIN(..) KEEP (DENSE_RANK FIRST ..); client reproduces
  // get_standards_client ('Multiple' when >1, else the single client); the
  // FSP-ID list reproduces results_get_fsp_id_list (up to four rownum<5 xref
  // rows, comma-joined, no leading comma). All three are correlated subqueries
  // that only materialise for the page's rows.
  private static final String SELECT_COLUMNS = """
      SELECT sr.standards_regime_id,
             sr.standards_regime_name,
             sr.standards_objective,
             (SELECT MIN(s.bgc_zone_code)    KEEP (DENSE_RANK FIRST ORDER BY s.standard_regime_site_series_id) || ' ' ||
                     MIN(s.bgc_subzone_code) KEEP (DENSE_RANK FIRST ORDER BY s.standard_regime_site_series_id) || ' ' ||
                     MIN(s.bgc_variant)      KEEP (DENSE_RANK FIRST ORDER BY s.standard_regime_site_series_id) || ' ' ||
                     MIN(s.bgc_phase)        KEEP (DENSE_RANK FIRST ORDER BY s.standard_regime_site_series_id) || ' ' ||
                     MIN(s.bec_site_series)  KEEP (DENSE_RANK FIRST ORDER BY s.standard_regime_site_series_id) || ' ' ||
                     MIN(s.bec_site_type)    KEEP (DENSE_RANK FIRST ORDER BY s.standard_regime_site_series_id) || ' ' ||
                     MIN(s.bec_seral)        KEEP (DENSE_RANK FIRST ORDER BY s.standard_regime_site_series_id)
                FROM the.standards_regime_site_series s
               WHERE s.standards_regime_id = sr.standards_regime_id) bgc,
             (SELECT CASE WHEN COUNT(DISTINCT c.client_number) > 1 THEN 'Multiple'
                          ELSE MAX(c.client_number) END
                FROM the.standards_regime_client c
               WHERE c.standards_regime_id = sr.standards_regime_id) client_number,
             srsc.description status,
             TO_CHAR(sr.expiry_date, 'YYYY-MM-DD') expiry_date,
             (SELECT LISTAGG(x.fsp_id, ',') WITHIN GROUP (ORDER BY x.fsp_id)
                FROM (SELECT fsrx.fsp_id
                        FROM the.fsp_standards_regime_xref fsrx
                       WHERE fsrx.standards_regime_id = sr.standards_regime_id
                         AND rownum < 5) x) fsp_id_list""";

  // The status code is LEFT-joined for the description (the proc outer-joins
  // it); it never drops rows. The count query doesn't need it. Leads with a
  // newline so it never jams against the SELECT-columns block's trailing alias.
  private static final String FROM =
      """

        FROM the.standards_regime sr
        LEFT JOIN the.standards_regime_status_code srsc
          ON srsc.standards_regime_status_code = sr.standards_regime_status_code""";

  private static final String DEFAULT_ORDER =
      " ORDER BY sr.standards_regime_id ";

  // sortBy (front-end field) → orderable SQL column/alias. Allow-listed so
  // arbitrary input can't inject. Unknown → standards regime id.
  private static final Map<String, String> SORT_COLUMNS = Map.of(
      "standardsRegimeId", "sr.standards_regime_id",
      "standardsRegimeName", "sr.standards_regime_name",
      "standardsObjective", "sr.standards_objective",
      "status", "srsc.description",
      "expiryDate", "sr.expiry_date",
      "bgc", "bgc",
      "clientNumber", "client_number",
      "fspIdList", "fsp_id_list"
  );

  private static final RowMapper<Fsp501StdsSrchDao.Row> ROW_MAPPER = (rs, n) -> new Fsp501StdsSrchDao.Row(
      rs.getString("standards_regime_id"),
      rs.getString("standards_regime_name"),
      rs.getString("standards_objective"),
      rs.getString("bgc"),
      rs.getString("client_number"),
      rs.getString("status"),
      rs.getString("expiry_date"),
      rs.getString("fsp_id_list"));

  @Override
  public List<Fsp501StdsSrchDao.Row> search(SearchCriteria c) {
    List<String> where = new ArrayList<>();
    MapSqlParameterSource params = new MapSqlParameterSource();
    appendFilters(c, where, params);
    return jdbc.query(searchSql(whereClause(where)), params, ROW_MAPPER);
  }

  @Override
  public Page searchPage(SearchCriteria c, int page, int size, String sortBy, String sortDir) {
    List<String> where = new ArrayList<>();
    MapSqlParameterSource params = new MapSqlParameterSource();
    appendFilters(c, where, params);
    String whereSql = whereClause(where);

    Long total = jdbc.queryForObject(
        "SELECT COUNT(*) FROM the.standards_regime sr" + whereSql, params, Long.class);
    long count = total == null ? 0L : total;

    params.addValue("offset", (long) page * size);
    params.addValue("limit", size);
    List<Fsp501StdsSrchDao.Row> rows =
        jdbc.query(pageSql(whereSql, sortBy, sortDir), params, ROW_MAPPER);
    return new Page(rows, count);
  }

  /** Full SELECT + FROM + WHERE + default ORDER (no pagination). */
  static String searchSql(String whereSql) {
    return SELECT_COLUMNS + FROM + whereSql + DEFAULT_ORDER;
  }

  /** Paginated SELECT with the resolved ORDER BY + OFFSET/FETCH binds. */
  static String pageSql(String whereSql, String sortBy, String sortDir) {
    return SELECT_COLUMNS + FROM + whereSql + orderByClause(sortBy, sortDir)
        + " OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY";
  }

  private static String whereClause(List<String> where) {
    return where.isEmpty() ? "" : " WHERE " + String.join(" AND ", where);
  }

  static String orderByClause(String sortBy, String sortDir) {
    String col = SORT_COLUMNS.getOrDefault(sortBy, "sr.standards_regime_id");
    String dir = "desc".equalsIgnoreCase(sortDir) ? "DESC" : "ASC";
    // Stable tiebreaker so pagination is deterministic.
    if ("sr.standards_regime_id".equals(col)) {
      return " ORDER BY sr.standards_regime_id " + dir;
    }
    return " ORDER BY " + col + " " + dir + " NULLS LAST, sr.standards_regime_id ASC";
  }

  /**
   * Verbatim port of the proc's dynamic WHERE. Every value is bound. The
   * BGC/BEC LIKE filters go into ONE {@code EXISTS} over the site-series so
   * they must all match the same row (the proc applies them to a single
   * {@code srss} join).
   */
  static void appendFilters(
      SearchCriteria c, List<String> where, MapSqlParameterSource params) {

    if (notBlank(c.standardsRegimeId())) {
      where.add("sr.standards_regime_id = :regimeId");
      params.addValue("regimeId", Long.valueOf(c.standardsRegimeId().trim()));
    }
    if (notBlank(c.orgUnitNo())) {
      where.add("""
          EXISTS (SELECT 1 FROM the.standards_regime_org_unit srou
                   WHERE srou.standards_regime_id = sr.standards_regime_id
                     AND srou.org_unit_no = :orgUnitNo)""");
      params.addValue("orgUnitNo", Long.valueOf(c.orgUnitNo().trim()));
    }
    if (notBlank(c.clientNumber())) {
      where.add("""
          EXISTS (SELECT 1 FROM the.standards_regime_client src
                   WHERE src.standards_regime_id = sr.standards_regime_id
                     AND src.client_number = :clientNumber)""");
      params.addValue("clientNumber", c.clientNumber().trim());
    }
    if (notBlank(c.standardsRegimeName())) {
      where.add("sr.standards_regime_name LIKE '%' || :regimeName || '%'");
      params.addValue("regimeName", c.standardsRegimeName().trim());
    }
    if (notBlank(c.standardsRegimeStatusCode())) {
      where.add("sr.standards_regime_status_code = :statusCode");
      params.addValue("statusCode", c.standardsRegimeStatusCode().trim());
    }
    if (notBlank(c.defaultStandard())) {
      where.add("NVL(sr.mof_default_standard_ind, 'N') = :defaultStandard");
      params.addValue("defaultStandard", c.defaultStandard().trim());
    }
    if (notBlank(c.fspId())) {
      where.add("""
          EXISTS (SELECT 1 FROM the.fsp_standards_regime_xref fsrx
                   WHERE fsrx.standards_regime_id = sr.standards_regime_id
                     AND fsrx.fsp_id = :fspId)""");
      params.addValue("fspId", Long.valueOf(c.fspId().trim()));
    }
    if (notBlank(c.preferredSpecies())) {
      where.add("""
          EXISTS (SELECT 1 FROM the.standards_regime_layer srl
                    JOIN the.standards_regime_layer_species sp
                      ON sp.standards_regime_layer_id = srl.standards_regime_layer_id
                   WHERE srl.standards_regime_id = sr.standards_regime_id
                     AND sp.silv_tree_species_code = :prefSpecies
                     AND sp.preferred_ind = 'Y')""");
      params.addValue("prefSpecies", c.preferredSpecies().trim());
    }
    if (notBlank(c.acceptableSpecies())) {
      where.add("""
          EXISTS (SELECT 1 FROM the.standards_regime_layer srl
                    JOIN the.standards_regime_layer_species sp
                      ON sp.standards_regime_layer_id = srl.standards_regime_layer_id
                   WHERE srl.standards_regime_id = sr.standards_regime_id
                     AND sp.silv_tree_species_code = :accSpecies
                     AND sp.preferred_ind = 'N')""");
      params.addValue("accSpecies", c.acceptableSpecies().trim());
    }
    if (notBlank(c.expiryDateFrom())) {
      where.add("sr.expiry_date >= TO_DATE(:expiryFrom, 'YYYY-MM-DD')");
      params.addValue("expiryFrom", c.expiryDateFrom().trim());
    }
    if (notBlank(c.expiryDateTo())) {
      where.add("sr.expiry_date <= TO_DATE(:expiryTo, 'YYYY-MM-DD')");
      params.addValue("expiryTo", c.expiryDateTo().trim());
    }
    appendSiteSeriesFilter(c, where, params);
  }

  // BGC/BEC LIKE filters — one EXISTS so all conditions hit the same
  // site-series row (parity with the proc's single srss join).
  private static void appendSiteSeriesFilter(
      SearchCriteria c, List<String> where, MapSqlParameterSource params) {
    List<String> conds = new ArrayList<>();
    addLike(conds, params, "bgc_zone_code", "bgcZone", c.bgcZoneCode());
    addLike(conds, params, "bgc_subzone_code", "bgcSubzone", c.bgcSubzoneCode());
    addLike(conds, params, "bgc_variant", "bgcVariant", c.bgcVariant());
    addLike(conds, params, "bgc_phase", "bgcPhase", c.bgcPhase());
    addLike(conds, params, "bec_site_series", "becSiteSeries", c.becSiteSeriesCd());
    addLike(conds, params, "bec_site_type", "becSiteType", c.becSiteSeriesPhaseCd());
    addLike(conds, params, "bec_seral", "becSeral", c.becSeral());
    if (conds.isEmpty()) return;
    where.add(
        "EXISTS (SELECT 1 FROM the.standards_regime_site_series ss"
            + " WHERE ss.standards_regime_id = sr.standards_regime_id AND "
            + String.join(" AND ", conds) + ")");
  }

  private static void addLike(
      List<String> conds, MapSqlParameterSource params,
      String column, String bind, String value) {
    if (!notBlank(value)) return;
    conds.add("ss." + column + " LIKE '%' || :" + bind + " || '%'");
    params.addValue(bind, value.trim());
  }

  private static boolean notBlank(String s) {
    return s != null && !s.trim().isEmpty();
  }
}
