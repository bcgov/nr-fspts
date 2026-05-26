package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Mirrors a single row of the PKG_SIL21_CLIENT_SEARCH.get_client_search
 * REF CURSOR. clientName is the already-concatenated "Surname, First
 * Middle" form the proc builds via DECODE; consume verbatim.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ClientSearchResult {
  private String clientNumber;
  private String clientAcronym;
  private String displayClientNumber;
  private String clientName;
  private String legalFirstName;
  private String legalMiddleName;
  private String clientLocnCode;
  private String clientLocnName;
  private String city;
  private String clientStatusCode;
}
