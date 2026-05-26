package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Search criteria for PKG_SIL21_CLIENT_SEARCH.get_client_search.
 * Field names mirror the proc's P_* params (lowercased). Page/size/sort
 * are post-cursor pagination applied by ClientSearchService — the proc
 * itself doesn't paginate.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ClientSearchRequest {

  private String clientNumber;
  private String clientAcronym;
  private String clientName;        // last name (FOREST_CLIENT.CLIENT_NAME column)
  private String legalFirstName;
  private String legalMiddleName;

  @Builder.Default private Integer page = 0;
  @Builder.Default private Integer size = 10;
}
