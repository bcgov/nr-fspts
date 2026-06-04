package ca.bc.gov.nrs.fsp.api.struct.v1;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Editable subset of {@link StandardRegimeDetail} accepted by the
 * Overview-tab SAVE endpoint. Fields the proc treats as system-managed
 * (status code, default-standard flag, amendment#, regulation, etc.)
 * are intentionally absent — the service overlays only the values the
 * caller can change onto a freshly-read regime row and round-trips the
 * rest verbatim.
 *
 * <p>Null in any field means "no change" — empty string clears.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StandardRegimeOverviewUpdate {
  private String standardsRegimeName;
  private String standardsObjective;
  private String geographicDescription;
  private String additionalStandards;
  private String effectiveDate;
  private String expiryDate;
  private String regenObligationInd;
  private String regenDelayOffsetYrs;
  private String freeGrowingEarlyOffsetYrs;
  private String freeGrowingLateOffsetYrs;
}
