package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Search criteria for FSP_501_STDS_SRCH.MAINLINE. Field names mirror
 * the P_* parameters of the legacy package (lowercased).
 *
 * <p>BGC sub-criteria are exposed but currently unused by the front-end
 * (cascading-lookup UI deferred); blank values short-circuit the proc's
 * NVL/UPPER WHERE clauses.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StandardsSearchRequest {

  private String defaultStandard;             // Y/N or null
  private String standardsRegimeStatusCode;
  private String orgUnitNo;                   // numeric org_unit_no
  private String fspId;
  private String clientNumber;
  private String clientName;
  private String standardsRegimeId;
  private String standardsRegimeName;
  private String standardsObjective;
  private String preferredSpecies;
  private String acceptableSpecies;
  private String expiryDateFrom;              // YYYY-MM-DD
  private String expiryDateTo;                // YYYY-MM-DD
  private String bgcZoneCode;
  private String bgcSubzoneCode;
  private String bgcVariant;
  private String bgcPhase;
  private String becSiteSeriesCd;
  private String becSiteSeriesPhaseCd;
  private String becSeral;

  // Pagination + sort applied post-cursor in the service layer.
  @Builder.Default private Integer page = 0;
  @Builder.Default private Integer size = 10;
  @Builder.Default private String sortBy = "standardsRegimeId";
  @Builder.Default private String sortDir = "asc";
}
