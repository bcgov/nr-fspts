package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Search criteria for fsp_200_inbox.MAINLINE. Mirrors the five P_*
 * parameters the proc accepts beyond P_ACTION ("FETCH"). The legacy
 * FSP200 inbox form scoped to the user's org_unit by default; that
 * fallback is applied in InboxService when orgUnitNo is blank.
 *
 * Pagination + sort are applied in-memory after reading the full
 * cursor — same approach FspSearchRequest uses for the global search.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class InboxRequest {

  private String orgUnitNo;
  private String fspId;
  private String fspPlanName;
  private String fspStatusCode;
  private String ahClientNumber;

  @Builder.Default private Integer page = 0;
  @Builder.Default private Integer size = 10;
  @Builder.Default private String sortBy = "fspId";
  @Builder.Default private String sortDir = "desc";
}
