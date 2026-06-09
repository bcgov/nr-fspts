package ca.bc.gov.nrs.fsp.api.dao.v1;

import java.util.List;

/**
 * Wraps Oracle package {@code THE.SIL_52_BGC_SEARCH_V003} — the BEC
 * zone lookup that backs the FSP250 BGC Zone Add dialog (legacy SIL52A).
 *
 * <p>Important: this is the V003 wrapper around {@code BIOGEOCLIMATIC_CATALOGUE}
 * + {@code SITE_SERIES_CATALOGUE}, NOT {@code PKG_SIL52_BGC_SEARCH} (which
 * targets the older BEC_CODE_TABLE, has only 4 search params, and is
 * not granted to FSP roles). The V003 package is the one the legacy
 * nr-fsp app actually calls, and is granted to every FSP_* role.
 *
 * <p>{@code MAINLINE} dispatches on a {@code p_action} flag — only
 * {@code GET} is implemented today. The shape is 9 INOUT VARCHARs +
 * 1 INOUT REF CURSOR (10 params total). Empty/blank criteria match
 * everything; the proc wraps each non-null filter as a {@code LIKE '%X%'}
 * via {@code sil_sql.strip_like_predicate}.
 */
public interface Sil52BgcSearchDao {

  String PACKAGE_NAME = "SIL_52_BGC_SEARCH_V003";
  String PROCEDURE_NAME = "MAINLINE";
  String ACTION_GET = "GET";

  /** Single cursor row from {@code MAINLINE(p_action='GET')}. */
  record Row(
      String bgcZoneCode,
      String bgcSubzoneCode,
      String bgcVariant,
      String bgcPhase,
      String becSiteSeriesCd,
      String becSiteSeriesPhaseCd,
      String becSeral,
      /** From {@code NVL(site_series.description, biogeoclimatic.notes)}. */
      String siteSeriesDesc
  ) {}

  List<Row> getBgcSearch(
      String pBgcZoneCode,
      String pBgcSubzoneCode,
      String pBgcVariant,
      String pBgcPhase,
      String pBecSiteSeriesCd,
      String pBecSiteSeriesPhaseCd,
      String pBecSeral);
}
