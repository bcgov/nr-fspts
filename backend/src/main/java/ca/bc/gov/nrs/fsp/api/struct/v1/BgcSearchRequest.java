package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Search criteria for {@code SIL_52_BGC_SEARCH_V003.MAINLINE(p_action='GET')}
 * — backs the BGC Zone search dialog. All seven BEC criteria are
 * blank-tolerant; the proc adds a {@code LIKE '%X%'} clause per non-null
 * value and omits the predicate for nulls.
 *
 * <p>Page/size are post-cursor pagination applied in the service layer.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BgcSearchRequest {

  private String bgcZoneCode;
  private String bgcSubzoneCode;
  private String bgcVariant;
  private String bgcPhase;
  private String becSiteSeriesCd;
  private String becSiteSeriesPhaseCd;
  private String becSeral;

  @Builder.Default private Integer page = 0;
  @Builder.Default private Integer size = 10;
}
