package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp100SearchDao;
import ca.bc.gov.nrs.fsp.api.dao.v1.FspSearchDirectDao;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Direct-SQL implementation of {@link FspSearchDirectDao}. See the interface
 * for why this exists; the visibility predicate here is a verbatim port of
 * {@code FSP_100_SEARCH.get_search_criteria} and must stay in lock-step with
 * it (parity test gates that).
 */
@Repository
@Slf4j
public class FspSearchDirectDaoImpl implements FspSearchDirectDao {

  private final NamedParameterJdbcTemplate jdbc;

  public FspSearchDirectDaoImpl(NamedParameterJdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  // The org-unit list and agreement-holder client numbers are aggregated
  // per-FSP via scalar LISTAGG subqueries (', ' separator matches the
  // legacy FSP_COMMON.get_fsp_org_units), aliased so ORDER BY can key off
  // them. The base WHERE mirrors the proc's inner joins to FSP_ORG_UNIT and
  // FSP_AGREEMENT_HOLDER as EXISTS semi-joins (so the row set matches
  // without fan-out / DISTINCT). The proc also inner-joins
  // FSP_STATUS_HISTORY on fsp_id only — that join is never referenced, is
  // the root of the perf cliff, and only ever drops history-less drafts; it
  // is intentionally omitted (see parity test).
  private static final String SELECT_COLUMNS = """
      SELECT fsp.fsp_id,
             fsp.plan_name,
             fsp.licensee_amendment_name,
             (SELECT LISTAGG(ou.org_unit_code, ', ') WITHIN GROUP (ORDER BY ou.org_unit_code)
                FROM the.fsp_org_unit fou
                JOIN the.org_unit ou ON ou.org_unit_no = fou.org_unit_no
               WHERE fou.fsp_id = fsp.fsp_id
                 AND fou.fsp_amendment_number = fsp.fsp_amendment_number) org_units,
             TO_CHAR(fsp.plan_start_date, 'YYYY-MM-DD'),
             TO_CHAR(fsp.plan_end_date, 'YYYY-MM-DD'),
             fsp.fsp_amendment_number,
             (SELECT LISTAGG(fah.client_number, ', ') WITHIN GROUP (ORDER BY fah.client_number)
                FROM the.fsp_agreement_holder fah
               WHERE fah.fsp_id = fsp.fsp_id
                 AND fah.fsp_amendment_number = fsp.fsp_amendment_number) agreement_holder,
             fsp.amendment_approval_requird_ind,
             fsc.description""";

  // FROM + the always-on predicates, shared by the page query and (sans
  // SELECT list) the count query. fsc is inner-joined for the status
  // description / ORDER BY fspStatusDesc; it never drops rows (FK).
  private static final String FROM_AND_BASE_WHERE = """
        FROM the.forest_stewardship_plan fsp
        JOIN the.fsp_status_code fsc ON fsc.fsp_status_code = fsp.fsp_status_code
       WHERE fsp.fsp_status_code <> 'DEL'
         AND EXISTS (SELECT 1 FROM the.fsp_org_unit fou
                      WHERE fou.fsp_id = fsp.fsp_id
                        AND fou.fsp_amendment_number = fsp.fsp_amendment_number)
         AND EXISTS (SELECT 1 FROM the.fsp_agreement_holder fah
                      WHERE fah.fsp_id = fsp.fsp_id
                        AND fah.fsp_amendment_number = fsp.fsp_amendment_number)""";

  // The count needs no fsc join and no subqueries — just how many FSP rows
  // match the same predicates.
  private static final String COUNT_FROM_AND_BASE_WHERE = """
      SELECT COUNT(*)
        FROM the.forest_stewardship_plan fsp
       WHERE fsp.fsp_status_code <> 'DEL'
         AND EXISTS (SELECT 1 FROM the.fsp_org_unit fou
                      WHERE fou.fsp_id = fsp.fsp_id
                        AND fou.fsp_amendment_number = fsp.fsp_amendment_number)
         AND EXISTS (SELECT 1 FROM the.fsp_agreement_holder fah
                      WHERE fah.fsp_id = fsp.fsp_id
                        AND fah.fsp_amendment_number = fsp.fsp_amendment_number)""";

  private static final String DEFAULT_ORDER =
      " ORDER BY fsp.fsp_id DESC, fsp.fsp_amendment_number DESC";

  // sortBy (front-end field) → orderable SQL column/alias. Allow-listed so
  // arbitrary input can't reach the ORDER BY. Mirrors FspService.SORT_KEYS.
  private static final Map<String, String> SORT_COLUMNS = Map.of(
      "fspId", "fsp.fsp_id",
      "planName", "fsp.plan_name",
      "fspAmendmentNumber", "fsp.fsp_amendment_number",
      "fspAmendmentName", "fsp.licensee_amendment_name",
      "orgUnitCode", "org_units",
      "planStartDate", "fsp.plan_start_date",
      "planEndDate", "fsp.plan_end_date",
      "fspStatusDesc", "fsc.description",
      "agreementHolder", "agreement_holder");

  private static final RowMapper<Fsp100SearchDao.Row> ROW_MAPPER = (rs, i) -> new Fsp100SearchDao.Row(
      rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
      rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8),
      rs.getString(9), rs.getString(10));

  @Override
  public List<Fsp100SearchDao.Row> search(SearchCriteria c) {
    String orgLevelCode = resolveOrgLevel(c.orgUnitNo());
    MapSqlParameterSource params = new MapSqlParameterSource();
    String sql = buildSql(c, orgLevelCode, params);
    return jdbc.query(sql, params, ROW_MAPPER);
  }

  @Override
  public Page searchPage(SearchCriteria c, int page, int size, String sortBy, String sortDir) {
    String orgLevelCode = resolveOrgLevel(c.orgUnitNo());

    MapSqlParameterSource countParams = new MapSqlParameterSource();
    String countSql = COUNT_FROM_AND_BASE_WHERE + predicateTail(c, orgLevelCode, countParams);
    Long total = jdbc.queryForObject(countSql, countParams, Long.class);
    long totalCount = total == null ? 0L : total;
    if (totalCount == 0) {
      return new Page(List.of(), 0);
    }

    MapSqlParameterSource pageParams = new MapSqlParameterSource();
    String pageSql = SELECT_COLUMNS + FROM_AND_BASE_WHERE
        + predicateTail(c, orgLevelCode, pageParams)
        + orderByClause(sortBy, sortDir)
        + " OFFSET :pageOffset ROWS FETCH NEXT :pageSize ROWS ONLY";
    pageParams.addValue("pageOffset", (long) page * size);
    pageParams.addValue("pageSize", size);
    return new Page(jdbc.query(pageSql, pageParams, ROW_MAPPER), totalCount);
  }

  /** Region-vs-district org filtering keys off org_level_code, same as the proc. */
  private String resolveOrgLevel(String orgUnitNo) {
    if (isBlank(orgUnitNo)) return null;
    try {
      return jdbc.queryForObject(
          "SELECT org_level_code FROM the.org_unit WHERE org_unit_no = :n",
          new MapSqlParameterSource("n", Long.valueOf(orgUnitNo.trim())), String.class);
    } catch (EmptyResultDataAccessException | NumberFormatException e) {
      return null;
    }
  }

  /**
   * Full SELECT for {@link #search} (all rows, default order). Kept for the
   * proc-parity test; pure (no DB) so it's unit-testable.
   */
  static String buildSql(SearchCriteria c, String orgLevelCode, MapSqlParameterSource params) {
    return SELECT_COLUMNS + FROM_AND_BASE_WHERE + predicateTail(c, orgLevelCode, params) + DEFAULT_ORDER;
  }

  /**
   * The applicable predicates as a {@code " AND ..."} string, plus their
   * binds. Shared verbatim by the page, count, and full-set queries so all
   * three filter identically. Pure — no DB access.
   */
  static String predicateTail(SearchCriteria c, String orgLevelCode, MapSqlParameterSource params) {
    List<String> where = new ArrayList<>();

    appendVisibility(c, where, params);

    if (notBlank(c.approvalRequired())) {
      where.add("fsp.amendment_approval_requird_ind = :approval");
      params.addValue("approval", c.approvalRequired().trim());
    }
    if (notBlank(c.fspId())) {
      where.add("fsp.fsp_id = :fspId");
      params.addValue("fspId", Long.valueOf(c.fspId().trim()));
    }
    if (notBlank(c.fspPlanName())) {
      where.add("LOWER(fsp.plan_name) LIKE :planName");
      params.addValue("planName", "%" + c.fspPlanName().trim().toLowerCase() + "%");
    }
    if (notBlank(c.fspAmendmentName())) {
      where.add("LOWER(fsp.licensee_amendment_name) LIKE :amendmentName");
      params.addValue("amendmentName", "%" + c.fspAmendmentName().trim().toLowerCase() + "%");
    }

    appendOrgFilter(c, orgLevelCode, where, params);

    if (notBlank(c.ahClientNumber())) {
      where.add(ahExists("ahClient"));
      params.addValue("ahClient", c.ahClientNumber().trim());
    }

    appendDateFilter(c, where, params);
    appendStatusFilter(c, where, params);

    StringBuilder tail = new StringBuilder();
    for (String w : where) {
      tail.append("\n         AND ").append(w);
    }
    return tail.toString();
  }

  /**
   * sortBy/sortDir → ORDER BY, allow-listed. fsp_id/amendment are a stable
   * tiebreaker; NULLS LAST matches the in-memory comparator's nullsLast.
   */
  static String orderByClause(String sortBy, String sortDir) {
    String col = SORT_COLUMNS.getOrDefault(sortBy, "fsp.fsp_id");
    String dir = "asc".equalsIgnoreCase(sortDir) ? "ASC" : "DESC";
    if ("fsp.fsp_id".equals(col)) {
      return " ORDER BY fsp.fsp_id " + dir + ", fsp.fsp_amendment_number DESC";
    }
    return " ORDER BY " + col + " " + dir + " NULLS LAST,"
        + " fsp.fsp_id DESC, fsp.fsp_amendment_number DESC";
  }

  /**
   * Role/client visibility — verbatim port of get_search_criteria. The
   * proc's {@code fah.client_number = X} predicates become EXISTS
   * semi-joins (no FAH join in the outer query). IF/ELSIF order is
   * preserved exactly, including the quirk that an Administrator who also
   * holds View-All is restricted to APP/INE.
   */
  private static void appendVisibility(
      SearchCriteria c, List<String> where, MapSqlParameterSource params) {
    String roles = c.legacyRoles() == null ? "" : c.legacyRoles().toUpperCase();
    boolean viewAll = roles.contains("FSP_VIEW_ALL");
    boolean submitter = roles.contains("FSP_SUBMITTER");
    boolean viewOnly = roles.contains("FSP_VIEW_ONLY");
    String client = isBlank(c.userClientNumber()) ? null : c.userClientNumber().trim();

    if (viewAll && submitter) {
      // APP/INE, OR own-client FSPs; a null client sees everything.
      if (client != null) {
        where.add("(fsp.fsp_status_code IN ('APP','INE') OR " + ahExists("accessClient") + ")");
        params.addValue("accessClient", client);
      }
    } else if (viewAll) {
      where.add("fsp.fsp_status_code IN ('APP','INE')");
    } else if (submitter) {
      if (client != null) {
        where.add(ahExists("accessClient"));
        params.addValue("accessClient", client);
      }
      // null client → ministry user → no restriction (proc: 1 = 1)
    } else if (viewOnly) {
      if (client != null) {
        where.add("fsp.fsp_status_code IN ('APP','INE')");
        where.add(ahExists("accessClient"));
        params.addValue("accessClient", client);
      } else {
        where.add("1 = 2"); // no client → see nothing (proc: 1 = 2)
      }
    }
    // else (Administrator / Reviewer / Decision Maker only) → no restriction
  }

  private static void appendOrgFilter(
      SearchCriteria c, String orgLevelCode, List<String> where, MapSqlParameterSource params) {
    if (isBlank(c.orgUnitNo())) return;
    Long orgUnit;
    try {
      orgUnit = Long.valueOf(c.orgUnitNo().trim());
    } catch (NumberFormatException e) {
      return;
    }
    if ("D".equals(orgLevelCode)) {
      where.add("""
          EXISTS (SELECT 1 FROM the.fsp_org_unit fou2
                   WHERE fou2.fsp_id = fsp.fsp_id
                     AND fou2.fsp_amendment_number = fsp.fsp_amendment_number
                     AND fou2.org_unit_no = :orgUnit)""");
      params.addValue("orgUnit", orgUnit);
    } else if ("R".equals(orgLevelCode)) {
      where.add("""
          EXISTS (SELECT 1 FROM the.fsp_org_unit fou2
                  JOIN the.org_unit ou2 ON ou2.org_unit_no = fou2.org_unit_no
                   WHERE fou2.fsp_id = fsp.fsp_id
                     AND fou2.fsp_amendment_number = fsp.fsp_amendment_number
                     AND ou2.rollup_region_no = :orgUnit)""");
      params.addValue("orgUnit", orgUnit);
    }
    // Unknown level → proc adds no org predicate; match that.
  }

  private static void appendDateFilter(
      SearchCriteria c, List<String> where, MapSqlParameterSource params) {
    boolean hasStart = notBlank(c.fspDateStart());
    boolean hasEnd = notBlank(c.fspDateEnd());
    if (!hasStart && !hasEnd) return;
    String col = dateColumn(c.fspDateType());
    if (hasStart && hasEnd) {
      where.add(col + " BETWEEN TO_DATE(:dateStart,'YYYY-MM-DD') AND TO_DATE(:dateEnd,'YYYY-MM-DD')");
      params.addValue("dateStart", c.fspDateStart().trim());
      params.addValue("dateEnd", c.fspDateEnd().trim());
    } else if (hasStart) {
      where.add(col + " >= TO_DATE(:dateStart,'YYYY-MM-DD')");
      params.addValue("dateStart", c.fspDateStart().trim());
    } else {
      where.add(col + " < TO_DATE(:dateEnd,'YYYY-MM-DD')");
      params.addValue("dateEnd", c.fspDateEnd().trim());
    }
  }

  /** Date-type → column, from an allow-list (never user free-text). Mirrors the proc. */
  private static String dateColumn(String dateType) {
    String t = dateType == null ? "" : dateType.trim().toUpperCase();
    return switch (t) {
      case "INITIATION" -> "fsp.entry_timestamp";
      case "DECISION" -> "fsp.plan_decision_date";
      case "EFFECTIVE" -> "fsp.plan_start_date";
      case "EXPIRY" -> "fsp.plan_end_date";
      default -> "fsp.amendment_submission_date";
    };
  }

  private static void appendStatusFilter(
      SearchCriteria c, List<String> where, MapSqlParameterSource params) {
    if (isBlank(c.fspStatusCode())) return;
    String status = c.fspStatusCode().trim();
    if ("APP".equals(status)) {
      // Selecting Approved implies In-Effect too, same as the proc.
      where.add("fsp.fsp_status_code IN ('APP','INE')");
    } else {
      where.add("fsp.fsp_status_code = :status");
      params.addValue("status", status);
    }
  }

  private static String ahExists(String paramName) {
    return "EXISTS (SELECT 1 FROM the.fsp_agreement_holder fahx"
        + " WHERE fahx.fsp_id = fsp.fsp_id"
        + " AND fahx.fsp_amendment_number = fsp.fsp_amendment_number"
        + " AND fahx.client_number = :" + paramName + ")";
  }

  private static boolean isBlank(String s) {
    return s == null || s.trim().isEmpty();
  }

  private static boolean notBlank(String s) {
    return !isBlank(s);
  }
}
