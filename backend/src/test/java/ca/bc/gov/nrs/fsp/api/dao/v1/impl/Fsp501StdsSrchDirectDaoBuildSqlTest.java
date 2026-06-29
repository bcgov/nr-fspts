package ca.bc.gov.nrs.fsp.api.dao.v1.impl;

import ca.bc.gov.nrs.fsp.api.dao.v1.Fsp501StdsSrchDirectDao.SearchCriteria;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for the standards-search SQL builder — the filter port of
 * {@code FSP_501_STDS_SRCH.MAINLINE} and the sort allow-list. No DB; pure
 * string/param assertions. Row-set parity vs the proc is the (DB-gated)
 * parity IT.
 */
class Fsp501StdsSrchDirectDaoBuildSqlTest {

  private record Built(List<String> where, MapSqlParameterSource params) {}

  private Built filters(SearchCriteria c) {
    List<String> where = new ArrayList<>();
    MapSqlParameterSource params = new MapSqlParameterSource();
    Fsp501StdsSrchDirectDaoImpl.appendFilters(c, where, params);
    return new Built(where, params);
  }

  private static SearchCriteria blank() {
    return new SearchCriteria(null, null, null, null, null, null, null, null,
        null, null, null, null, null, null, null, null, null, null);
  }

  @Test
  void noCriteria_producesNoWhereFragments() {
    assertThat(filters(blank()).where()).isEmpty();
  }

  @Test
  void regimeIdAndFspId_areBoundAsNumbersViaExists() {
    SearchCriteria c = new SearchCriteria(null, null, null, "12345", null,
        "777", null, null, null, null, null, null, null, null, null, null, null, null);
    Built b = filters(c);
    assertThat(String.join(" AND ", b.where()))
        .contains("sr.standards_regime_id = :regimeId")
        .contains("fsp_standards_regime_xref fsrx")
        .contains("fsrx.fsp_id = :fspId");
    assertThat(b.params().getValue("regimeId")).isEqualTo(777L);
    assertThat(b.params().getValue("fspId")).isEqualTo(12345L);
  }

  @Test
  void orgUnitAndClient_becomeExistsSemiJoins() {
    SearchCriteria c = new SearchCriteria(null, null, "55", null, "00012345",
        null, null, null, null, null, null, null, null, null, null, null, null, null);
    String sql = String.join(" AND ", filters(c).where());
    assertThat(sql).contains("standards_regime_org_unit srou")
        .contains("srou.org_unit_no = :orgUnitNo")
        .contains("standards_regime_client src")
        .contains("src.client_number = :clientNumber");
  }

  @Test
  void species_useLayerSpeciesWithPreferredIndYandN() {
    SearchCriteria c = new SearchCriteria(null, null, null, null, null, null, null,
        "PL", "SX", null, null, null, null, null, null, null, null, null);
    String sql = String.join(" AND ", filters(c).where());
    assertThat(sql).contains("sp.silv_tree_species_code = :prefSpecies")
        .contains("sp.preferred_ind = 'Y'")
        .contains("sp.silv_tree_species_code = :accSpecies")
        .contains("sp.preferred_ind = 'N'");
  }

  @Test
  void bgcAndBecFilters_collapseIntoOneSiteSeriesExists() {
    SearchCriteria c = new SearchCriteria(null, null, null, null, null, null, null, null,
        null, null, null, "CWH", "vm", null, null, "01", null, null);
    List<String> where = filters(c).where();
    // One combined EXISTS over the site-series, not three separate ones.
    long siteSeriesClauses = where.stream()
        .filter(w -> w.contains("standards_regime_site_series ss")).count();
    assertThat(siteSeriesClauses).isEqualTo(1);
    assertThat(where).anySatisfy(w -> assertThat(w)
        .contains("ss.bgc_zone_code LIKE")
        .contains("ss.bgc_subzone_code LIKE")
        .contains("ss.bec_site_series LIKE"));
  }

  @Test
  void defaultStandardAndExpiry_areBound() {
    SearchCriteria c = new SearchCriteria("Y", null, null, null, null, null, null, null,
        null, "2024-01-01", "2025-12-31", null, null, null, null, null, null, null);
    Built b = filters(c);
    String sql = String.join(" AND ", b.where());
    assertThat(sql).contains("NVL(sr.mof_default_standard_ind, 'N') = :defaultStandard")
        .contains("sr.expiry_date >= TO_DATE(:expiryFrom")
        .contains("sr.expiry_date <= TO_DATE(:expiryTo");
    assertThat(b.params().getValue("defaultStandard")).isEqualTo("Y");
  }

  @Test
  void assembledSql_keepsKeywordsSeparated() {
    // Regression: the SELECT-columns block and the FROM block must not jam
    // together (a missing separator made the alias swallow FROM → ORA-00923).
    for (String sql : new String[] {
        Fsp501StdsSrchDirectDaoImpl.searchSql(""),
        Fsp501StdsSrchDirectDaoImpl.pageSql("", "standardsRegimeId", "asc"),
        Fsp501StdsSrchDirectDaoImpl.pageSql(" WHERE sr.standards_regime_id = :regimeId",
            "standardsRegimeName", "desc")}) {
      // No non-whitespace char immediately before the FROM keyword.
      assertThat(sql).doesNotContainPattern("\\S+FROM the\\.standards_regime sr");
      assertThat(sql).contains("\nFROM the.standards_regime sr");
    }
    assertThat(Fsp501StdsSrchDirectDaoImpl.pageSql("", "standardsRegimeId", "asc"))
        .contains("FETCH NEXT :limit ROWS ONLY");
  }

  @Test
  void orderBy_allowsKnownColumnsAndDefaultsForUnknown() {
    assertThat(Fsp501StdsSrchDirectDaoImpl.orderByClause("standardsRegimeName", "desc"))
        .contains("sr.standards_regime_name DESC")
        .contains("sr.standards_regime_id ASC"); // tiebreaker
    assertThat(Fsp501StdsSrchDirectDaoImpl.orderByClause("bgc", "asc"))
        .contains("bgc ASC");
    // Unknown / injection attempt falls back to the regime id.
    assertThat(Fsp501StdsSrchDirectDaoImpl.orderByClause("; DROP TABLE", "asc"))
        .isEqualTo(" ORDER BY sr.standards_regime_id ASC");
  }
}
