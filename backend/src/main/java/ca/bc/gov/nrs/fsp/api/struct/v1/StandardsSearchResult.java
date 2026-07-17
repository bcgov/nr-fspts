package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One row of FSP_501_STDS_SRCH results. Columns map 1-1 to the
 * legacy cursor: STANDARDS_REGIME_ID, STANDARDS_REGIME_NAME,
 * STANDARDS_OBJECTIVE, BGC, CLIENT_NUMBER, STATUS, EXPIRY_DATE,
 * FSP_ID_LIST.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StandardsSearchResult {
  private String standardsRegimeId;
  private String standardsRegimeName;
  private String standardsObjective;
  private String bgc;
  private String clientNumber;
  private String status;
  private String expiryDate;
  private String fspIdList;
  // 'Y' when this is a MoF default standard — drives the Add(link) vs Copy
  // choice in the Add-existing-standard modal (legacy parity).
  private String mofDefaultStandardInd;
}
