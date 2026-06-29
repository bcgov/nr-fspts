package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.util.List;

/**
 * Direct-SQL replacement for {@code FSP_501_STDS_SRCH.MAINLINE} (see
 * {@link Fsp501StdsSrchDao}). The legacy proc builds dynamic SQL over a
 * six-table comma-join with {@code SELECT DISTINCT} + {@code FIRST_VALUE}
 * window functions, and calls two PL/SQL scalar functions <em>per row</em>
 * ({@code results_get_fsp_id_list} and {@code get_standards_client}); a
 * species filter adds two more {@code standards_regime_layer_species} joins,
 * which is what forces the expensive {@code DISTINCT} over the multiplied row
 * set. Same fan-out shape as {@code FSP_100_SEARCH}.
 *
 * <p>This query removes the fan-out: every filter (org unit, client, species,
 * BGC/BEC, fsp id) becomes an {@code EXISTS} semi-join, so there's one row per
 * standards regime and no {@code DISTINCT}. The two per-row scalar functions
 * become correlated subqueries computed only for the page's rows:
 * <ul>
 *   <li>BGC — {@code MIN(...) KEEP (DENSE_RANK FIRST ORDER BY
 *       standard_regime_site_series_id)} over {@code standards_regime_site_series}
 *       (the proc's {@code FIRST_VALUE}).</li>
 *   <li>client number — {@code CASE WHEN COUNT(DISTINCT client_number) > 1 THEN
 *       'Multiple' ELSE MAX(client_number) END} (the {@code get_standards_client}
 *       logic).</li>
 *   <li>FSP-ID list — {@code LISTAGG} over up to four {@code rownum < 5}
 *       xref rows, no leading comma (matches {@code results_get_fsp_id_list}).</li>
 * </ul>
 * All inputs are bound (the proc concatenates literals — also why its plan is
 * unstable). Standards search has no role/client visibility predicate, so this
 * is a straight filter port; the parity test gates row-for-row equivalence.
 */
public interface Fsp501StdsSrchDirectDao {

  /**
   * Search inputs. Mirror the proc's {@code P_*} parameters that actually
   * filter (the proc's {@code p_client_name} is output-only and there is no
   * objective filter). Blank/null criteria are ignored.
   */
  record SearchCriteria(
      String defaultStandard,
      String standardsRegimeStatusCode,
      String orgUnitNo,
      String fspId,
      String clientNumber,
      String standardsRegimeId,
      String standardsRegimeName,
      String preferredSpecies,
      String acceptableSpecies,
      String expiryDateFrom,
      String expiryDateTo,
      String bgcZoneCode,
      String bgcSubzoneCode,
      String bgcVariant,
      String bgcPhase,
      String becSiteSeriesCd,
      String becSiteSeriesPhaseCd,
      String becSeral
  ) {}

  /** One page of results plus the exact total matching row count. */
  record Page(List<Fsp501StdsSrchDao.Row> rows, long total) {}

  /**
   * Runs the full search and returns every matching row (no pagination).
   * Used by the proc-parity test to diff the complete row set; prefer
   * {@link #searchPage} for the request path.
   */
  List<Fsp501StdsSrchDao.Row> search(SearchCriteria criteria);

  /**
   * Paginated search. Pagination, ordering, and the total count are pushed
   * into SQL — only the page's rows materialise the BGC / client / FSP-list
   * subqueries, and the count query skips them. {@code sortBy} is mapped
   * through an allow-list (unknown → standards regime id); {@code sortDir}
   * is asc/desc.
   */
  Page searchPage(SearchCriteria criteria, int page, int size, String sortBy, String sortDir);
}
