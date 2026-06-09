package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One row of the cursor returned by
 * {@code SIL_52_BGC_SEARCH_V003.MAINLINE(p_action='GET')}. Sourced from
 * {@code BIOGEOCLIMATIC_CATALOGUE} outer-joined to
 * {@code SITE_SERIES_CATALOGUE}, so any of the site-series columns may
 * be null even when the BGC quadruple (zone/subzone/variant/phase) is
 * fully populated.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BgcSearchResult {
  private String bgcZoneCode;
  private String bgcSubzoneCode;
  private String bgcVariant;
  private String bgcPhase;
  private String becSiteSeriesCd;
  private String becSiteSeriesPhaseCd;
  private String becSeral;
  /** {@code NVL(site_series.description, biogeoclimatic.notes)}. */
  private String siteSeriesDesc;
}
