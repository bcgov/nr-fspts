package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.FspSearchDirectDao.SearchCriteria;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for the direct-search SQL builder, focused on the
 * security-critical part: the role/client visibility predicate, which is a
 * verbatim port of {@code FSP_100_SEARCH.get_search_criteria}. No DB — pure
 * string/param assertions.
 *
 * <p>The against-the-DB row-set parity vs the proc lives in
 * {@code FspSearchProcParityIT} (DB-gated).
 */
class FspSearchDirectDaoBuildSqlTest {

  private static final String AH_EXISTS_FRAGMENT = "fsp_agreement_holder fahx";

  private record Built(String sql, MapSqlParameterSource params) {}

  private Built build(SearchCriteria c, String orgLevel) {
    MapSqlParameterSource p = new MapSqlParameterSource();
    String sql = FspSearchDirectDaoImpl.buildSql(c, orgLevel, p);
    return new Built(sql, p);
  }

  /** Criteria with only roles + client set; everything else blank. */
  private static SearchCriteria roleOnly(String roles, String client) {
    return new SearchCriteria(null, null, null, null, null, null, null, null,
        null, null, client, roles);
  }

  // ── Visibility matrix (the verbatim port) ────────────────────────────

  @Test
  void administrator_only_hasNoVisibilityRestriction() {
    Built b = build(roleOnly("FSP_ADMINISTRATOR,", null), null);
    // No APP/INE restriction, no agreement-holder semi-join, no 1=2.
    assertThat(b.sql()).doesNotContain("IN ('APP','INE')");
    assertThat(b.sql()).doesNotContain(AH_EXISTS_FRAGMENT);
    assertThat(b.sql()).doesNotContain("1 = 2");
  }

  @Test
  void reviewerAndDecisionMaker_haveNoVisibilityRestriction() {
    for (String role : new String[] {"FSP_REVIEWER,", "FSP_DECISION_MAKER,"}) {
      Built b = build(roleOnly(role, "00012345"), null);
      assertThat(b.sql()).as(role).doesNotContain("IN ('APP','INE')");
      assertThat(b.sql()).as(role).doesNotContain(AH_EXISTS_FRAGMENT);
    }
  }

  @Test
  void viewAll_restrictsToApprovedAndInEffect() {
    Built b = build(roleOnly("FSP_VIEW_ALL,", null), null);
    assertThat(b.sql()).contains("fsp.fsp_status_code IN ('APP','INE')");
    assertThat(b.sql()).doesNotContain(AH_EXISTS_FRAGMENT);
  }

  @Test
  void submitterWithClient_restrictsToOwnAgreementHolderFsps() {
    Built b = build(roleOnly("FSP_SUBMITTER,", "00012345"), null);
    assertThat(b.sql()).contains(AH_EXISTS_FRAGMENT);
    assertThat(b.sql()).contains(":accessClient");
    assertThat(b.params().getValue("accessClient")).isEqualTo("00012345");
    // Submitter alone is not status-restricted.
    assertThat(b.sql()).doesNotContain("IN ('APP','INE')");
  }

  @Test
  void submitterWithoutClient_isMinistryUser_noRestriction() {
    Built b = build(roleOnly("FSP_SUBMITTER,", null), null);
    assertThat(b.sql()).doesNotContain(AH_EXISTS_FRAGMENT);
    assertThat(b.sql()).doesNotContain("1 = 2");
  }

  @Test
  void viewOnlyWithClient_restrictsToOwnApprovedFsps() {
    Built b = build(roleOnly("FSP_VIEW_ONLY,", "00012345"), null);
    assertThat(b.sql()).contains("fsp.fsp_status_code IN ('APP','INE')");
    assertThat(b.sql()).contains(AH_EXISTS_FRAGMENT);
    assertThat(b.params().getValue("accessClient")).isEqualTo("00012345");
  }

  @Test
  void viewOnlyWithoutClient_seesNothing() {
    Built b = build(roleOnly("FSP_VIEW_ONLY,", null), null);
    assertThat(b.sql()).contains("1 = 2");
  }

  @Test
  void viewAllAndSubmitterWithClient_seesApprovedOrOwn() {
    Built b = build(roleOnly("FSP_VIEW_ALL,FSP_SUBMITTER,", "00012345"), null);
    // (APP/INE OR own-client) as a single OR group.
    assertThat(b.sql()).contains("(fsp.fsp_status_code IN ('APP','INE') OR ");
    assertThat(b.sql()).contains(AH_EXISTS_FRAGMENT);
    assertThat(b.params().getValue("accessClient")).isEqualTo("00012345");
  }

  @Test
  void viewAllAndSubmitterWithoutClient_seesEverything() {
    Built b = build(roleOnly("FSP_VIEW_ALL,FSP_SUBMITTER,", null), null);
    assertThat(b.sql()).doesNotContain("IN ('APP','INE')");
    assertThat(b.sql()).doesNotContain(AH_EXISTS_FRAGMENT);
  }

  // ── Filters ──────────────────────────────────────────────────────────

  @Test
  void districtOrgFilter_usesDirectOrgUnitSemiJoin() {
    SearchCriteria c = new SearchCriteria(null, null, "1894", null, null, null,
        null, null, null, null, null, "FSP_ADMINISTRATOR,");
    Built b = build(c, "D");
    assertThat(b.sql()).contains("fou2.org_unit_no = :orgUnit");
    assertThat(b.sql()).doesNotContain("rollup_region_no");
    assertThat(b.params().getValue("orgUnit")).isEqualTo(1894L);
  }

  @Test
  void regionOrgFilter_usesRollupRegionSemiJoin() {
    SearchCriteria c = new SearchCriteria(null, null, "1900", null, null, null,
        null, null, null, null, null, "FSP_ADMINISTRATOR,");
    Built b = build(c, "R");
    assertThat(b.sql()).contains("ou2.rollup_region_no = :orgUnit");
    assertThat(b.params().getValue("orgUnit")).isEqualTo(1900L);
  }

  @Test
  void statusApproved_expandsToApprovedAndInEffect() {
    SearchCriteria c = new SearchCriteria(null, null, null, null, null, null,
        null, null, "APP", null, null, "FSP_ADMINISTRATOR,");
    Built b = build(c, null);
    assertThat(b.sql()).contains("fsp.fsp_status_code IN ('APP','INE')");
    assertThat(b.params().hasValue("status")).isFalse();
  }

  @Test
  void statusOther_isBoundEquality() {
    SearchCriteria c = new SearchCriteria(null, null, null, null, null, null,
        null, null, "SUB", null, null, "FSP_ADMINISTRATOR,");
    Built b = build(c, null);
    assertThat(b.sql()).contains("fsp.fsp_status_code = :status");
    assertThat(b.params().getValue("status")).isEqualTo("SUB");
  }

  @Test
  void dateBetween_byType_bindsBothBounds() {
    SearchCriteria c = new SearchCriteria(null, null, null, null, null,
        "2026-01-01", "2026-12-31", "EFFECTIVE", null, null, null, "FSP_ADMINISTRATOR,");
    Built b = build(c, null);
    assertThat(b.sql()).contains("fsp.plan_start_date BETWEEN TO_DATE(:dateStart");
    assertThat(b.params().getValue("dateStart")).isEqualTo("2026-01-01");
    assertThat(b.params().getValue("dateEnd")).isEqualTo("2026-12-31");
  }

  @Test
  void planNameAndApprovalAndFspId_areAllBound() {
    SearchCriteria c = new SearchCriteria("123", "Mackenzie", null, null, null,
        null, null, null, null, "Y", null, "FSP_ADMINISTRATOR,");
    Built b = build(c, null);
    assertThat(b.sql()).contains("fsp.fsp_id = :fspId");
    assertThat(b.params().getValue("fspId")).isEqualTo(123L);
    assertThat(b.sql()).contains("LOWER(fsp.plan_name) LIKE :planName");
    assertThat(b.params().getValue("planName")).isEqualTo("%mackenzie%");
    assertThat(b.sql()).contains("fsp.amendment_approval_requird_ind = :approval");
    assertThat(b.params().getValue("approval")).isEqualTo("Y");
  }

  @Test
  void agreementHolderFilter_addsSemiJoinBoundToAhClient() {
    SearchCriteria c = new SearchCriteria(null, null, null, "00099999", null, null,
        null, null, null, null, null, "FSP_ADMINISTRATOR,");
    Built b = build(c, null);
    assertThat(b.sql()).contains(":ahClient");
    assertThat(b.params().getValue("ahClient")).isEqualTo("00099999");
  }

  @Test
  void alwaysOrdersByFspIdThenAmendmentDescending() {
    Built b = build(roleOnly("FSP_ADMINISTRATOR,", null), null);
    assertThat(b.sql()).endsWith("ORDER BY fsp.fsp_id DESC, fsp.fsp_amendment_number DESC");
    // No DISTINCT — the EXISTS semi-joins mean one row per FSP/amendment.
    assertThat(b.sql()).doesNotContain("DISTINCT");
  }

  // ── ORDER BY mapping (SQL-side pagination) ───────────────────────────

  @Test
  void orderBy_defaultsToFspIdWithAmendmentTiebreaker() {
    assertThat(FspSearchDirectDaoImpl.orderByClause("fspId", "desc"))
        .isEqualTo(" ORDER BY fsp.fsp_id DESC, fsp.fsp_amendment_number DESC");
  }

  @Test
  void orderBy_unknownKey_fallsBackToFspId() {
    // Not in the allow-list → must not reach the ORDER BY.
    assertThat(FspSearchDirectDaoImpl.orderByClause("fsp.fsp_id; DROP TABLE", "asc"))
        .isEqualTo(" ORDER BY fsp.fsp_id ASC, fsp.fsp_amendment_number DESC");
  }

  @Test
  void orderBy_mappedColumn_getsDirectionNullsLastAndStableTiebreaker() {
    String clause = FspSearchDirectDaoImpl.orderByClause("planName", "asc");
    assertThat(clause).isEqualTo(
        " ORDER BY fsp.plan_name ASC NULLS LAST, fsp.fsp_id DESC, fsp.fsp_amendment_number DESC");
  }

  @Test
  void orderBy_listaggAliasIsSortable() {
    assertThat(FspSearchDirectDaoImpl.orderByClause("orgUnitCode", "desc"))
        .startsWith(" ORDER BY org_units DESC NULLS LAST");
    assertThat(FspSearchDirectDaoImpl.orderByClause("agreementHolder", "asc"))
        .startsWith(" ORDER BY agreement_holder ASC NULLS LAST");
  }
}
