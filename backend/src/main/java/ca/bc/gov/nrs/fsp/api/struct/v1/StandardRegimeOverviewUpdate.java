package ca.bc.gov.nrs.fsp.api.struct.v1;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
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
 *
 * <p>Tolerates unknown properties: the global
 * {@code fail-on-unknown-properties=true} would otherwise turn any
 * field the client sends that this DTO doesn't model into a
 * "Malformed JSON request" 400. Editable-subset payloads drift as the
 * UI form evolves, so ignore extras here rather than reject the save.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class StandardRegimeOverviewUpdate {
  private String standardsRegimeName;
  private String standardsObjective;
  private String geographicDescription;
  private String additionalStandards;
  /** SILV_STATUTE_CODE — the "Regulation" radio on the Overview tab. */
  private String regulationCode;
  private String effectiveDate;
  private String expiryDate;
  private String regenObligationInd;
  private String regenDelayOffsetYrs;
  private String freeGrowingEarlyOffsetYrs;
  private String freeGrowingLateOffsetYrs;
  /** "No regen obligations" offsets — Early / Late only (no Regen delay). */
  private String noRegenEarlyOffsetYrs;
  private String noRegenLateOffsetYrs;
}
