package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.util.List;

/**
 * Direct-SQL replacement for {@code FSP_100_SEARCH.MAINLINE} (see
 * {@link Fsp100SearchDao}). The legacy proc builds a five-table join with
 * unused fan-out (`FSP_ORG_UNIT`, `FSP_AGREEMENT_HOLDER`, and an
 * unreferenced `FSP_STATUS_HISTORY` joined on {@code fsp_id} only) plus a
 * {@code SELECT DISTINCT}; a selective org-unit predicate then flips the
 * optimizer from a hash plan to nested loops over that fan-out, which is
 * why filtering by one district can take minutes. See the
 * search-perf-investigation note.
 *
 * <p>This query removes the fan-out entirely: the org-unit list and the
 * agreement-holder client numbers come from scalar {@code LISTAGG}
 * subqueries, and every filter (org unit, agreement holder) plus the
 * proc's inner joins become {@code EXISTS} semi-joins — so there's one row
 * per FSP/amendment, no {@code DISTINCT}, and a selective org filter only
 * narrows the set. All inputs are bound (no literal concatenation), which
 * stabilises the plan and avoids a hard parse per value.
 *
 * <p>It reads the granted tables directly ({@code FOREST_STEWARDSHIP_PLAN},
 * {@code FSP_ORG_UNIT}, {@code ORG_UNIT}, {@code FSP_AGREEMENT_HOLDER},
 * {@code FSP_STATUS_CODE}, {@code FSP_STATUS_HISTORY}). It deliberately
 * does NOT touch {@code FOREST_CLIENT} (the proxy user lacks SELECT on it),
 * so the agreement-holder column shows the client <em>number</em> rather
 * than the legacy acronym — accepted by business.
 *
 * <p>The role/client visibility predicate is ported verbatim from the
 * proc's {@code get_search_criteria}, expressed as {@code EXISTS}
 * semi-joins. Keeping it in lock-step with the proc is security-critical;
 * see the parity test.
 */
public interface FspSearchDirectDao {

  /**
   * Search inputs. Mirrors the proc parameters. {@code legacyRoles} is the
   * comma-delimited {@code FSP_*} role string ({@code RequestUtil.getCurrentLegacyRoles()})
   * and {@code userClientNumber} the caller's active-org client — together
   * they drive the visibility predicate. Blank/null criteria are ignored.
   */
  record SearchCriteria(
      String fspId,
      String fspPlanName,
      String orgUnitNo,
      String ahClientNumber,
      String fspAmendmentName,
      String fspDateStart,
      String fspDateEnd,
      String fspDateType,
      String fspStatusCode,
      String approvalRequired,
      String userClientNumber,
      String legacyRoles
  ) {}

  /** One page of results plus the exact total matching row count. */
  record Page(List<Fsp100SearchDao.Row> rows, long total) {}

  /**
   * Runs the full search and returns every matching row (no pagination).
   * Used by the proc-parity test to diff the complete row set; prefer
   * {@link #searchPage} for the request path.
   */
  List<Fsp100SearchDao.Row> search(SearchCriteria criteria);

  /**
   * Paginated search. Pagination, ordering, and the total count are all
   * pushed into SQL — only the page's rows materialise their org-unit /
   * agreement-holder {@code LISTAGG} subqueries and cross the wire, and the
   * count query skips those subqueries entirely. {@code sortBy} is mapped
   * through an allow-list (unknown → fspId); {@code sortDir} is asc/desc.
   */
  Page searchPage(SearchCriteria criteria, int page, int size, String sortBy, String sortDir);

  /**
   * Reads an amendment's "summary of changes" — stored by
   * FSP_300_INFORMATION as the {@code status_comment} on the amendment's
   * original DRAFT status-history row. The plain FSP GET proc never
   * surfaces it (only VIEW_AMEND / VIEW_REPLACE do), so we read it
   * directly to populate {@code amendmentReason} on the FSP load.
   *
   * @return the reason, or {@code null} when none is recorded.
   */
  String getAmendmentReason(String fspId, String amendmentNumber);
}
