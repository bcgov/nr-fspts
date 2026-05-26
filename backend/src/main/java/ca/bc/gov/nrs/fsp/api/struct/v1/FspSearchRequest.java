package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Search criteria for FSP_100_SEARCH.MAINLINE. Field names mirror the P_*
 * parameters of the legacy package (lowercased).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FspSearchRequest {

  private String fspId;
  private String fspPlanName;
  private String orgUnitNo;
  private String ahClientNumber;
  private String fspAmendmentName;
  private String fspDateStart;
  private String fspDateEnd;
  private String fspDateType;
  private String fspStatusCode;
  private String approvalRequired;

  // Pagination + sort. Not part of the PL/SQL proc surface; applied
  // post-cursor by FspService. Defaults match the front-end's initial
  // table state (page=0, size=10, sort by FSP ID descending).
  @Builder.Default private Integer page = 0;
  @Builder.Default private Integer size = 10;
  @Builder.Default private String sortBy = "fspId";
  @Builder.Default private String sortDir = "desc";
}
